const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');

const manifest = {
    id: 'org.streamedaddon.sports',
    version: '1.0.0',
    name: 'Streamed Sports',
    description: 'Assista a partidas esportivas ao vivo integradas com a API Streamed',
    types: ['tv', 'other'],
    catalogs: [
        {
            type: 'tv',
            id: 'streamed_football',
            name: 'Streamed - Futebol'
        }
    ],
    resources: ['catalog', 'stream'],
    idPrefixes: ['streamed:']
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id }) => {
    try {
        const response = await fetch('https://streamed.pk/api/matches/football');
        const matches = await response.json();
        
        const metas = matches.map((match, index) => {
            const firstSource = match.sources?.[0];
            const sourceName = firstSource?.source || 'default';
            const sourceId = firstSource?.id || index;
            
            return {
                id: `streamed:${sourceName}:${sourceId}`,
                type: 'tv',
                name: match.title || `${match.teams?.home?.name || 'Time A'} vs ${match.teams?.away?.name || 'Time B'}`,
                poster: match.poster ? `https://streamed.pk/api/images/${match.poster}` : undefined,
                description: `Categoria: ${match.category} | Início: ${new Date(match.date).toLocaleTimeString()}`
            };
        });
        
        return { metas };
    } catch (error) {
        console.error('Erro ao buscar partidas:', error);
        return { metas: [] };
    }
});

builder.defineStreamHandler(async ({ id }) => {
    try {
        const parts = id.split(':');
        if (parts.length < 3) return { streams: [] };
        
        const source = parts[1];
        const sourceId = parts.slice(2).join(':');

        const response = await fetch(`https://streamed.pk/api/stream/${source}/${sourceId}`);
        const streamsData = await response.json();
        
        const rawStreams = Array.isArray(streamsData) ? streamsData : [streamsData];
        
        // CORRIGIDO: Fechamento do .map() com '))'
        const streams = rawStreams.map(s => ({
            title: s.name || s.resolution || 'Stream ao Vivo',
            url: s.url || s.embedUrl || s.streamUrl
        })).filter(s => s.url);

        return { streams };
    } catch (error) {
        console.error('Erro ao buscar streams:', error);
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

const app = express();
app.use('/', router);

module.exports = app;
