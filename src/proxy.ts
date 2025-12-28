import fs from 'fs-extra';
import path from 'path';

export class ProxyManager {
    private proxies: string[] = [];
    private currentIndex: number = 0;

    constructor() {
        this.loadProxies();
    }

    private loadProxies() {
        const proxyPath = path.join(process.cwd(), 'proxies.txt');
        if (fs.existsSync(proxyPath)) {
            const content = fs.readFileSync(proxyPath, 'utf-8');
            this.proxies = content.split('\n')
                .map(p => p.trim())
                .filter(p => p.length > 0);
            console.log(`Loaded ${this.proxies.length} proxies.`);
        } else {
            console.warn('No proxies.txt found. Running without proxies (Rate limits may apply).');
        }
    }

    public getNextProxy(): string | null {
        if (this.proxies.length === 0) return null;

        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
    }

    public hasProxies(): boolean {
        return this.proxies.length > 0;
    }
}
