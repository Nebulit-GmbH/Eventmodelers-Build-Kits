const components = new Map<string, any>()
export const modalComponentRegistry = {
    register(path: string, component: any, _title?: string): void { components.set(path, component) },
    get(path: string): any { return components.get(path) },
}
