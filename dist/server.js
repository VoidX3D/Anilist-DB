"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const path_1 = __importDefault(require("path"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./db");
const scraper_service_1 = require("./scraper-service");
const child_process_1 = require("child_process");
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, { cors: { origin: '*' } });
app.use((0, cors_1.default)());
app.use(express_1.default.static(path_1.default.join(process.cwd(), 'public')));
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
    const { start, end, resume, fromYear, toYear } = req.query;
    (0, scraper_service_1.runScraper)(io, {
        startId: start ? parseInt(start) : undefined,
        endId: end ? parseInt(end) : undefined,
        resume: resume === 'true',
        fromYear: fromYear ? parseInt(fromYear) : undefined,
        toYear: toYear ? parseInt(toYear) : undefined
    });
    res.json({ message: 'Scraper started' });
});
app.get('/api/pause', (req, res) => {
    (0, scraper_service_1.pauseScraper)();
    res.json({ message: 'Pausing...' });
});
app.get('/api/stop', (req, res) => {
    (0, scraper_service_1.stopScraper)();
    res.json({ message: 'Scraper stopping...' });
});
app.get('/api/status', (req, res) => {
    res.json((0, scraper_service_1.getScraperStatus)());
});
app.get('/api/flush', async (req, res) => {
    const success = await (0, scraper_service_1.flushAllData)();
    res.json({ success, message: success ? 'Data flushed successfully' : 'Flush failed' });
});
// Serve Dashboard
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(process.cwd(), 'public', 'index.html'));
});
// Socket Handler
io.on('connection', (socket) => {
    socket.emit('terminal-log', 'Connected to server backend.');
    socket.on('execute-command', (command) => {
        originalLog(`[SHELL] ${command}`);
        (0, child_process_1.exec)(command, (error, stdout, stderr) => {
            if (error) {
                socket.emit('terminal-log', `[ERROR] ${error.message}`);
                return;
            }
            if (stderr)
                socket.emit('terminal-log', `[STDERR] ${stderr}`);
            if (stdout)
                socket.emit('terminal-log', stdout);
        });
    });
});
// Initialize DB and Start Server
const PORT = 3000;
(0, db_1.initDB)().then(() => {
    httpServer.listen(PORT, () => {
        originalLog(`Dashboard running at http://localhost:${PORT}`);
    });
});
