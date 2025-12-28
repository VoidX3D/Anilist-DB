
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs-extra';
import cors from 'cors';
import { initDB } from './db';
import { runScraper, stopScraper, getScraperStatus, pauseScraper, resumeScraper, flushAllData } from './scraper-service';
import { exec } from 'child_process';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(cors());
app.use(express.static(path.join(process.cwd(), 'public')));

// Capture console logs and send to frontend
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => {
    originalLog(...args);
    io.emit('terminal-log', args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '));
};
console.warn = (...args) => {
    originalWarn(...args);
    io.emit('terminal-log', '[WARN] ' + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '));
};
console.error = (...args) => {
    originalError(...args);
    io.emit('terminal-log', '[ERROR] ' + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '));
};

// API Endpoints
app.get('/api/start', (req, res) => {
    const { start, end, resume, mode, minYear, maxYear, storageLimit } = req.query;
    runScraper(io, {
        startId: start ? parseInt(start as string) : undefined,
        endId: end ? parseInt(end as string) : undefined,
        resume: resume === 'true',
        useCache: true,
        mode: mode as string,
        minYear: minYear ? parseInt(minYear as string) : undefined,
        maxYear: maxYear ? parseInt(maxYear as string) : undefined,
        storageLimitGB: storageLimit ? parseInt(storageLimit as string) : undefined
    });
    res.json({ message: 'Scraper started' });
});

app.get('/api/pause', (req, res) => {
    pauseScraper();
    res.json({ message: 'Paused' });
});

app.get('/api/resume', (req, res) => {
    resumeScraper();
    res.json({ message: 'Resumed' });
});

app.get('/api/stop', (req, res) => {
    stopScraper();
    res.json({ message: 'Scraper stopping...' });
});

app.get('/api/status', (req, res) => {
    res.json(getScraperStatus());
});

app.get('/api/flush', async (req, res) => {
    const success = await flushAllData();
    res.json({ success, message: success ? 'Data flushed successfully' : 'Flush failed' });
});

// Serve Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Socket Handler
io.on('connection', (socket) => {
    socket.emit('terminal-log', 'Connected to server backend.');

    socket.on('execute-command', (command) => {
        originalLog(`[SHELL] ${command}`);
        exec(command, (error: any, stdout: string, stderr: string) => {
            if (error) {
                socket.emit('terminal-log', `[ERROR] ${error.message}`);
                return;
            }
            if (stderr) socket.emit('terminal-log', `[STDERR] ${stderr}`);
            if (stdout) socket.emit('terminal-log', stdout);
        });
    });
});

// Initialize DB and Start Server
const PORT = 3000;
initDB().then(() => {
    httpServer.listen(PORT, () => {
        originalLog(`Dashboard running at http://localhost:${PORT}`);
    });
});
