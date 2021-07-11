export class DefaultMap<K extends string | number | boolean, V extends any> {
    private map: Map<K, V>;

    constructor(protected factory: (key: K) => V) {
        this.map = new Map();
    }

    get(key: K): V {
        return this.map.has(key) ? (this.map.get(key) as V) : this.factory(key);
    }

    set(key: K, value: V): void {
        this.map.set(key, value);
    }

    entries() {
        return this.map.entries();
    }

    keys() {
        return this.map.keys();
    }

    values() {
        return this.map.values();
    }
}