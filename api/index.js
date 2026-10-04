const { addonBuilder, getRouter, landingTemplate } = require('stremio-addon-sdk');
const express = require('express');

const BASE_URL = 'https://streamed.pk';
const ID_PREFIX = 'streamed:';

const CATALOGS = [
    { id: 'live', name: '🔴 Ao Vivo Agora', path: '/api/matches/live' },
    { id: 'all', name: '🌐 Todos os Eventos', path: '/api/matches/all' }
];

const manifest = {
    id: 'org.streamedaddon.sports.custom',
    version: '1.9.0',
    name: 'Streamed Sports PRO',
    description: 'Transmissões desportivas ao vivo com suporte a múltiplos servidores e metadados.',
    types: ['tv', 'sports', 'other'],
    catalogs: CATALOGS.map(cat => ({
        type: 'tv',
        id: `streamed_${cat.id}`,
        name: cat.name,
        posterShape: 'landscape' // Altera a exibição do catálogo para formato Banner / Landscape (16:9)
    })),
    resources: ['catalog', 'stream', 'meta'],
    idPrefixes: [ID_PREFIX]
};

const builder = new addonBuilder(manifest);

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
    if (!id.startsWith('streamed_')) {
        return { metas: [] };
    }

    const catalogKey = id.replace('streamed_', '');
    const currentCatalog = CATALOGS.find(c => c.id === catalogKey);

    if (!currentCatalog) {
        return { metas: [] };
    }

    try {
        const response = await fetch(`${BASE_URL}${currentCatalog.path}`);
        if (!response.ok) return { metas: [] };

        const matches = await response.json();
        if (!Array.isArray(matches)) return { metas: [] };

        const metas = matches.map(match => {
            const formattedTime = match.date 
                ? new Date(match.date).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
                : 'Horário N/I';

            return {
                id: `${ID_PREFIX}${catalogKey}:${match.id}`,
                type: 'tv',
                name: match.title,
                poster: buildPosterUrl(match),
                posterShape: 'landscape', // Define cada cartão no formato banner/horizontal
                description: `🕒 Horário: ${formattedTime} | 📡 Servidores: ${match.sources?.length || 0}`
            };
        });

        return { metas };
    } catch (error) {
        console.error(`[Streamed Addon] Erro no catálogo ${catalogKey}:`, error);
        return { metas: [] };
    }
});

// Manipulador de Metadados
builder.defineMetaHandler(async ({ type, id }) => {
    if (!id.startsWith(ID_PREFIX)) {
        return { meta: null };
    }

    try {
        const cleanId = id.replace(ID_PREFIX, '');
        const parts = cleanId.split(':');
        if (parts.length < 2) return { meta: null };

        const catalogKey = parts[0];
        const matchId = parts.slice(1).join(':');

        const currentCatalog = CATALOGS.find(c => c.id === catalogKey);
        const endpoint = currentCatalog ? currentCatalog.path : '/api/matches/all';

        let matchRes = await fetch(`${BASE_URL}${endpoint}`);
        let matches = matchRes.ok ? await matchRes.json() : [];

        let match = Array.isArray(matches) ? matches.find(m => String(m.id) === String(matchId)) : null;

        if (!match && endpoint !== '/api/matches/all') {
            matchRes = await fetch(`${BASE_URL}/api/matches/all`);
            matches = matchRes.ok ? await matchRes.json() : [];
            match = Array.isArray(matches) ? matches.find(m => String(m.id) === String(matchId)) : null;
        }

        if (!match) return { meta: null };

        const formattedTime = match.date 
            ? new Date(match.date).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
            : 'Horário N/I';

        return {
            meta: {
                id: id,
                type: 'tv',
                name: match.title,
                poster: buildPosterUrl(match),
                posterShape: 'landscape',
                background: buildPosterUrl(match),
                description: `🕒 Horário: ${formattedTime} | 📡 Servidores disponíveis: ${match.sources?.length || 0}`
            }
        };
    } catch (error) {
        console.error('[Streamed Addon] Erro no meta handler:', error);
        return { meta: null };
    }
});

// Manipulador de Streams
builder.defineStreamHandler(async ({ id }) => {
    if (!id.startsWith(ID_PREFIX)) {
        return { streams: [] };
    }

    try {
        const cleanId = id.replace(ID_PREFIX, '');
        const parts = cleanId.split(':');
        if (parts.length < 2) return { streams: [] };

        const catalogKey = parts[0];
        const matchId = parts.slice(1).join(':');

        const currentCatalog = CATALOGS.find(c => c.id === catalogKey);
        const endpoint = currentCatalog ? currentCatalog.path : '/api/matches/all';

        let matchRes = await fetch(`${BASE_URL}${endpoint}`);
        let matches = matchRes.ok ? await matchRes.json() : [];

        let match = Array.isArray(matches) ? matches.find(m => String(m.id) === String(matchId)) : null;

        if (!match && endpoint !== '/api/matches/all') {
            matchRes = await fetch(`${BASE_URL}/api/matches/all`);
            matches = matchRes.ok ? await matchRes.json() : [];
            match = Array.isArray(matches) ? matches.find(m => String(m.id) === String(matchId)) : null;
        }

        if (!match || !Array.isArray(match.sources) || match.sources.length === 0) {
            return { streams: [] };
        }

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

        const streams = rawStreams
            .map(s => {
                const streamUrl = s.embedUrl || s.url;
                if (!streamUrl) return null;

                const hdLabel = s.hd ? 'HD' : 'SD';
                const langLabel = s.language ? ` 🌐 ${s.language}` : '';
                const sourceLabel = s.source ? ` [${s.source.toUpperCase()}]` : '';

                const isDirectVideo = streamUrl.includes('.m3u8') || streamUrl.includes('.mp4');

                if (isDirectVideo) {
                    return {
                        title: `▶️ Reproduzir Direto #${s.streamNo || 1}${langLabel} - ${hdLabel}${sourceLabel}`,
                        url: streamUrl
                    };
                }

                return {
                    title: `🌐 Abrir no Navegador #${s.streamNo || 1}${langLabel} - ${hdLabel}${sourceLabel}`,
                    externalUrl: streamUrl
                };
            })
            .filter(Boolean);

        return { streams };
    } catch (error) {
        console.error('[Streamed Addon] Erro ao buscar streams:', error);
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Cache-Control', 'max-age=60, s-maxage=60, stale-while-revalidate=120');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.get('/', (req, res) => {
    const landingHTML = landingTemplate(addonInterface);
    res.setHeader('Content-Type', 'text/html');
    res.send(landingHTML);
});

app.use('/', router);

module.exports = app;
