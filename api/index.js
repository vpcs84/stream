const { addonBuilder, getRouter, landingTemplate } = require('stremio-addon-sdk');
const express = require('express');

const BASE_URL = 'https://streamed.pk';

// Mapeamento de catálogos suportados
const CATALOGS = [
    { id: 'live', name: '🔴 Ao Vivo Agora', path: '/api/matches/live' },
    { id: 'live_popular', name: '🔥 Populares Ao Vivo', path: '/api/matches/live/popular' },
    { id: 'today', name: '📅 Jogos de Hoje', path: '/api/matches/all-today' },
    { id: 'football', name: '⚽ Futebol', path: '/api/matches/football' },
    { id: 'basketball', name: '🏀 Basquete', path: '/api/matches/basketball' },
    { id: 'tennis', name: '🎾 Tênis', path: '/api/matches/tennis' },
    { id: 'mma', name: '🥋 MMA', path: '/api/matches/mma' },
    { id: 'boxing', name: '🥊 Boxe', path: '/api/matches/boxing' },
    { id: 'motorsport', name: '🏎️ Automobilismo / F1', path: '/api/matches/motorsport' },
    { id: 'all', name: '🌐 Todos os Eventos', path: '/api/matches/all' }
];

const manifest = {
    id: 'org.streamedaddon.sports',
    version: '1.3.0',
    name: 'Streamed Sports Ultra',
    description: 'Transmissões esportivas ao vivo com suporte a múltiplos servidores, idiomas e imagens HD.',
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

// Função para construir URLs de imagens conforme a Images API
function buildPosterUrl(match) {
    if (match.poster) {
        if (match.poster.startsWith('http')) return match.poster;
        if (match.poster.startsWith('/')) return `${BASE_URL}${match.poster}.webp`;
        return `${BASE_URL}/api/images/proxy/${match.poster}.webp`;
    }
    
    const homeBadge = match.teams?.home?.badge;
    const awayBadge = match.teams?.away?.badge;

    if (homeBadge && awayBadge) {
        return `${BASE_URL}/api/images/poster/${homeBadge}/${awayBadge}.webp`;
    }
    if (homeBadge) {
        return `${BASE_URL}/api/images/badge/${homeBadge}.webp`;
    }
    return undefined;
}

// Manipulador do Catálogo
builder.defineCatalogHandler(async ({ type, id }) => {
    const catalogKey = id.replace('streamed_', '');
    const currentCatalog = CATALOGS.find(c => c.id === catalogKey) || CATALOGS[0];

    try {
        const response = await fetch(`${BASE_URL}${currentCatalog.path}`);
        if (!response.ok) return { metas: [] };

        const matches = await response.json();
        if (!Array.isArray(matches)) return { metas: [] };

        const metas = matches.map(match => {
            const formattedTime = match.date 
                ? new Date(match.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : 'Horário N/I';

            const popularBadge = match.popular ? '🔥 ' : '';
            const categoryBadge = match.category ? `[${match.category.toUpperCase()}] ` : '';

            return {
                id: `streamed:${catalogKey}:${match.id}`,
                type: 'tv',
                name: `${popularBadge}${categoryBadge}${match.title}`,
                poster: buildPosterUrl(match),
                description: `🕒 Horário: ${formattedTime} | 📡 Fontes: ${match.sources?.length || 0} disponível(is)`
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

        const catalogKey = parts[1];
        const matchId = parts.slice(2).join(':');

        const currentCatalog = CATALOGS.find(c => c.id === catalogKey);
        const endpoint = currentCatalog ? currentCatalog.path : '/api/matches/all';

        // 1. Busca os detalhes da partida para obter a lista de `sources`
        let matchRes = await fetch(`${BASE_URL}${endpoint}`);
        let matches = matchRes.ok ? await matchRes.json() : [];

        let match = Array.isArray(matches) ? matches.find(m => String(m.id) === String(matchId)) : null;

        // Fallback: se não encontrar no catálogo atual, busca no /api/matches/all
        if (!match && endpoint !== '/api/matches/all') {
            matchRes = await fetch(`${BASE_URL}/api/matches/all`);
            matches = matchRes.ok ? await matchRes.json() : [];
            match = Array.isArray(matches) ? matches.find(m => String(m.id) === String(matchId)) : null;
        }

        if (!match || !Array.isArray(match.sources) || match.sources.length === 0) {
            return { streams: [] };
        }

        // 2. Consulta a Streams API em paralelo para todos os servidores da partida
        const streamRequests = match.sources.map(async (src) => {
            try {
                const res = await fetch(`${BASE_URL}/api/stream/${src.source}/${src.id}`);
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data) ? data : [data];
            } catch {
                return [];
            }
        });

        const streamResults = await Promise.all(streamRequests);
        const rawStreams = streamResults.flat();

        // 3. Mapeia e formata os links de transmissão para o Stremio
        const streams = rawStreams
            .map(s => {
                const streamUrl = s.embedUrl || s.url;
                if (!streamUrl) return null;

                const hdLabel = s.hd ? 'HD 1080p' : 'SD';
                const langLabel = s.language ? ` 🌐 ${s.language}` : '';
                const sourceLabel = s.source ? ` [Server ${s.source.toUpperCase()}]` : '';

                return {
                    title: `🔴 Opção #${s.streamNo || 1}${langLabel} - ${hdLabel}${sourceLabel}`,
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

// Middleware de otimização de Cache para a Vercel
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'max-age=60, s-maxage=60, stale-while-revalidate=120');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// Página inicial HTML para instalação em um clique
app.get('/', (req, res) => {
    const landingHTML = landingTemplate(addonInterface);
    res.setHeader('Content-Type', 'text/html');
    res.send(landingHTML);
});

app.use('/', router);

module.exports = app;
