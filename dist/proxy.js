"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyManager = void 0;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
class ProxyManager {
    constructor() {
        this.proxies = [];
        this.currentIndex = 0;
        this.loadProxies();
    }
    loadProxies() {
        const proxyPath = path_1.default.join(process.cwd(), 'proxies.txt');
        if (fs_extra_1.default.existsSync(proxyPath)) {
            const content = fs_extra_1.default.readFileSync(proxyPath, 'utf-8');
            this.proxies = content.split('\n')
                .map(p => p.trim())
                .filter(p => p.length > 0);
            console.log(`Loaded ${this.proxies.length} proxies.`);
        }
        else {
            console.warn('No proxies.txt found. Running without proxies (Rate limits may apply).');
        }
    }
    getNextProxy() {
        if (this.proxies.length === 0)
            return null;
        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
    }
    hasProxies() {
        return this.proxies.length > 0;
    }
}
exports.ProxyManager = ProxyManager;
