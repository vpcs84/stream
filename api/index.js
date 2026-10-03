const { addonBuilder, getRouter, landingTemplate } = require('stremio-addon-sdk');
const express = require('express');

// Mapeamento de esportes suportados pela API Streamed
const SPORTS_CATALOG = [
    { id: 'football', name: 'Futebol' },
    { id: 'basketball', name: 'Basquete' },
    { id: 'motorsport', name: 'Automobilismo / F1' },
    { id: 'fight', name: 'Lutas / UFC' },
    { id: 'tennis', name: 'Tênis' }
];

const manifest = {
    id: 'org.streamedaddon.sports',
    version: '1.1.0',
    name: 'Streamed Sports PRO',
    description: 'Transmissões esportivas ao vivo (Futebol, F1, Basquete, UFC e Tênis).',
    types: ['tv', 'other'],
    catalogs: SPORTS_CATALOG.map(sport => ({
        type: 'tv',
        id: `streamed_${sport.id}`,
        name: `Streamed - ${sport.name}`
    })),
    resources: ['catalog', 'stream'],
    idPrefixes: ['streamed:']
};

const builder = new addonBuilder(manifest);

// Manipulador do Catálogo
builder.defineCatalogHandler(async ({ type, id }) => {
    const categoryMatch = id.replace('streamed_', '');
    const category = SPORTS_CATALOG.some(s => s.id === categoryMatch) ? categoryMatch : 'football';

    try {
        const response = await fetch(`https://streamed.pk/api/matches/${category}`);
        if (!response.ok) return { metas: [] };

        const matches = await response.json();
        if (!Array.isArray(matches)) return { metas: [] };

        const metas = matches.map((match, index) => {
            const firstSource = match.sources?.[0];
            const sourceName = firstSource?.source || 'default';
            const sourceId = firstSource?.id || index;
            
            const title = match.title || (match.teams ? `${match.teams.home?.name || 'Time A'} vs ${match.teams.away?.name || 'Time B'}` : 'Partida ao Vivo');
            const startTime = match.date ? new Date(match.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Hoje';

            return {
                id: `streamed:${sourceName}:${sourceId}`,
                type: 'tv',
                name: title,
                poster: match.poster ? `https://streamed.pk/api/images/${match.poster}` : undefined,
                description: `Esporte: ${category.toUpperCase()} | Horário: ${startTime} | Categoria: ${match.category || 'Geral'}`
            };
        });

        return { metas };
    } catch (error) {
        console.error(`Erro ao buscar catálogo de ${category}:`, error);
        return { metas: [] };
    }
});

// Manipulador de Streams
builder.defineStreamHandler(async ({ id }) => {
    try {
        const parts = id.split(':');
        if (parts.length < 3) return { streams: [] };

        const source = parts[1];
        const sourceId = parts.slice(2).join(':');

        const response = await fetch(`https://streamed.pk/api/stream/${source}/${sourceId}`);
        if (!response.ok) return { streams: [] };

        const streamsData = await response.json();
        const rawStreams = Array.isArray(streamsData) ? streamsData : [streamsData];

        const streams = rawStreams
            .map(s => {
                const streamUrl = s.url || s.embedUrl || s.streamUrl;
                if (!streamUrl) return null;

                const isEmbed = streamUrl.includes('embed') || !streamUrl.includes('.m3u8');
                return {
                    title: `🔴 ${s.name || s.quality || 'Opção de Stream'} ${isEmbed ? '(Web Embed)' : '(Direto)'}`,
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

// Middleware de Cache para a Vercel (Cache por 2 minutos na CDN, 5 minutos stale)
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'max-age=120, s-maxage=120, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// Rota inicial (Página HTML com botão de instalação)
app.get('/', (req, res) => {
    const landingHTML = landingTemplate(addonInterface);
    res.setHeader('Content-Type', 'text/html');
    res.send(landingHTML);
});

app.use('/', router);

module.exports = app;
