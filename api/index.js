const { addonBuilder, getRouter, landingTemplate } = require('stremio-addon-sdk');
const express = require('express');

// Lista de catálogos suportados
const CATALOGS = [
    { id: 'live', name: '🔴 Ao Vivo Agora', endpoint: '/api/matches/live' },
    { id: 'today', name: '📅 Jogos de Hoje', endpoint: '/api/matches/all-today' },
    { id: 'football', name: '⚽ Futebol', endpoint: '/api/matches/football' },
    { id: 'basketball', name: '🏀 Basquete', endpoint: '/api/matches/basketball' },
    { id: 'motorsport', name: '🏎️ Automobilismo / F1', endpoint: '/api/matches/motorsport' },
    { id: 'fight', name: '🥊 Lutas / UFC', endpoint: '/api/matches/fight' },
    { id: 'tennis', name: '🎾 Tênis', endpoint: '/api/matches/tennis' }
];

const manifest = {
    id: 'org.streamedaddon.sports',
    version: '1.2.0',
    name: 'Streamed Sports Official',
    description: 'Assista a eventos esportivos ao vivo com múltiplos servidores e idiomas.',
    types: ['tv', 'other'],
    catalogs: CATALOGS.map(cat => ({
        type: 'tv',
        id: `streamed_${cat.id}`,
        name: cat.name
    })),
    resources: ['catalog', 'stream'],
    idPrefixes: ['streamed:']
};

const builder = new addonBuilder(manifest);

// Função auxiliar para gerar URLs de imagens conforme a documentação
function buildPosterUrl(match) {
    if (match.poster) {
        if (match.poster.startsWith('http')) return match.poster;
        if (match.poster.startsWith('/')) return `https://streamed.pk${match.poster}.webp`;
        return `https://streamed.pk/api/images/proxy/${match.poster}.webp`;
    }
    if (match.teams?.home?.badge && match.teams?.away?.badge) {
        return `https://streamed.pk/api/images/poster/${match.teams.home.badge}/${match.teams.away.badge}.webp`;
    }
    if (match.teams?.home?.badge) {
        return `https://streamed.pk/api/images/badge/${match.teams.home.badge}.webp`;
    }
    return undefined;
}

// Manipulador de Catálogos
builder.defineCatalogHandler(async ({ type, id }) => {
    const catalogKey = id.replace('streamed_', '');
    const currentCatalog = CATALOGS.find(c => c.id === catalogKey) || CATALOGS[0];

    try {
        const response = await fetch(`https://streamed.pk${currentCatalog.endpoint}`);
        if (!response.ok) return { metas: [] };

        const matches = await response.json();
        if (!Array.isArray(matches)) return { metas: [] };

        const metas = matches.map(match => {
            const formattedDate = match.date 
                ? new Date(match.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : '';

            const categoryTag = match.category ? `[${match.category.toUpperCase()}] ` : '';
            const popularTag = match.popular ? '🔥 ' : '';

            return {
                id: `streamed:${catalogKey}:${match.id}`,
                type: 'tv',
                name: `${popularTag}${categoryTag}${match.title}`,
                poster: buildPosterUrl(match),
                description: `Horário: ${formattedDate} | Fontes disponíveis: ${match.sources?.length || 0}`
            };
        });

        return { metas };
    } catch (error) {
        console.error(`Erro ao carregar catálogo ${catalogKey}:`, error);
        return { metas: [] };
    }
});

// Manipulador de Streams
builder.defineStreamHandler(async ({ id }) => {
    try {
        const parts = id.split(':');
        if (parts.length < 3) return { streams: [] };

        const categoryKey = parts[1];
        const matchId = parts.slice(2).join(':');

        const currentCatalog = CATALOGS.find(c => c.id === categoryKey);
        const endpoint = currentCatalog ? currentCatalog.endpoint : '/api/matches/all';

        // 1. Busca a lista de partidas para localizar os sources da partida escolhida
        let matchRes = await fetch(`https://streamed.pk${endpoint}`);
        let matches = matchRes.ok ? await matchRes.json() : [];

        let match = Array.isArray(matches) ? matches.find(m => String(m.id) === String(matchId)) : null;

        // Fallback: se não encontrar no catálogo específico, busca no catálogo geral
        if (!match && endpoint !== '/api/matches/all') {
            matchRes = await fetch('https://streamed.pk/api/matches/all');
            matches = matchRes.ok ? await matchRes.json() : [];
            match = Array.isArray(matches) ? matches.find(m => String(m.id) === String(matchId)) : null;
        }

        if (!match || !Array.isArray(match.sources) || match.sources.length === 0) {
            return { streams: [] };
        }

        // 2. Consulta a Streams API para TODOS os sources da partida em paralelo
        const streamRequests = match.sources.map(async (src) => {
            try {
                const res = await fetch(`https://streamed.pk/api/stream/${src.source}/${src.id}`);
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data) ? data : [data];
            } catch {
                return [];
            }
        });

        const streamResults = await Promise.all(streamRequests);
        const rawStreams = streamResults.flat();

        // 3. Formata os links de transmissão para o Stremio
        const streams = rawStreams
            .map(s => {
                const streamUrl = s.embedUrl || s.url;
                if (!streamUrl) return null;

                const hdLabel = s.hd ? 'HD' : 'SD';
                const langLabel = s.language ? ` [${s.language}]` : '';
                const sourceLabel = s.source ? ` (${s.source.toUpperCase()})` : '';

                return {
                    title: `🔴 Opção ${s.streamNo || 1}${langLabel} - ${hdLabel}${sourceLabel}`,
                    url: streamUrl
                };
            })
            .filter(Boolean);

        return { streams };
    } catch (error) {
        console.error('Erro ao buscar streams:', error);
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

const app = express();

// Cache CDN para melhorar a performance na Vercel
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'max-age=60, s-maxage=60, stale-while-revalidate=120');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// Página Landing HTML para instalação
app.get('/', (req, res) => {
    const landingHTML = landingTemplate(addonInterface);
    res.setHeader('Content-Type', 'text/html');
    res.send(landingHTML);
});

app.use('/', router);

module.exports = app;
