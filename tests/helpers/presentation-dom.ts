export function withPresentationDOM(run: (container: HTMLElement) => void | Promise<void>) {
  const previous = ["document", "devicePixelRatio"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const context = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} };
  const element = () => ({ style: {}, textContent: "", setAttribute() {}, append() {}, remove() {}, getContext: () => context });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: element } });
  Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 1 });
  return Promise.resolve().then(() => run(element() as unknown as HTMLElement)).finally(() => {
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  });
}
