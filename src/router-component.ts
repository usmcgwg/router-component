export function extractPathParams(pattern: string, path: string): string[] {
    const regex = new RegExp(pattern);
    const matches = regex.exec(path);
    if (!matches) {
        return [];
    } else {
        const groups = [...matches];
        // remove first result since its not a capture group
        groups.shift();
        return groups;
    }
}

const routeComponents: Set<RouterComponent> = new Set();

export class RouterComponent extends HTMLElement {
    private shownPage: Element | undefined;
    private fragment: DocumentFragment;
    private changedUrlListener: () => void;
    private routeElements: Set<Element> = new Set();
    private clickedLinkListener: (e: any) => void;
    // TODO: fix below so that we are using pushState and replaceState method signatures on History type
    private historyChangeStates: [
        (data: any, title?: string, url?: string) => void,
        (data: any, title?: string, url?: string) => void
    ];
    private originalDocumentTitle: string;

    constructor() {
        super();
        this.fragment = document.createDocumentFragment();
        routeComponents.add(this);
        const children: HTMLCollection = this.children;
        while (children.length > 0) {
            const [element] = children;
            this.routeElements.add(element);
            this.fragment.appendChild(element);
        }
    }

    changedUrl(e: PopStateEvent) {
        const { pathname } = this.location;
        if (this.shownPage && this.shownPage.getAttribute('path') === pathname) return;
        this.show(pathname);
    }

    connectedCallback() {
        this.changedUrlListener = this.changedUrl.bind(this);
        window.addEventListener('popstate', this.changedUrlListener);
        this.bindLinks();

        // we must hijack pushState and replaceState because we need to
        // detect when consumer attempts to use and trigger a page load
        this.historyChangeStates = [window.history.pushState, window.history.replaceState];
        this.historyChangeStates.forEach(method => {
            window.history[method.name] = (...args) => {
                const [state] = args;
                method.apply(history, args);
                this.changedUrl(state);
            };
        });
        let path = this.location.pathname;
        if (this.extension && this.directory !== '/') {
            path = `/${this.filename}`;
        }
        this.show(path);
    }

    get filename(): string {
        return this.location.pathname.replace(this.directory, '');
    }

    get directory(): string {
        const { pathname } = this.location;
        return pathname.substring(0, pathname.lastIndexOf('/')) + '/';
    }

    get extension(): string {
        const { pathname } = this.location;
        const frags = pathname.split('.');
        if (frags.length <= 1) {
            return '';
        }
        return frags[frags.length - 1];
    }

    matchPathWithRegex(pathname: string = '', regex: string): RegExpMatchArray {
        if (!pathname.startsWith('/')) {
            pathname = `${this.directory}${pathname.replace(/^\//, '')}`;
        }
        return pathname.match(regex);
    }

    getRouteElementByPath(pathname: string): Element | undefined {
        let element: Element;
        if (!pathname) return;
        for (const child of this.routeElements) {
            let path = pathname;
            const search = child.getAttribute('search-params');
            if (search) {
                path = `${pathname}?${search}`;
            }
            if (this.matchPathWithRegex(path, child.getAttribute('path'))) {
                element = child;
                break;
            }
        }
        return element;
    }

    show(pathname: string) {
        if (!pathname) return;
        let router;

        const element = this.getRouteElementByPath(pathname);
        if (this.shownPage === element) {
            return;
        }
        if (!element) {
            router = this.getExternalRouterByPath(pathname);
            if (router) {
                return router.show(pathname);
            }
        }

        if (!element) {
            throw new Error(
                `Navigated to path "${pathname}" but there is no matching element with a path ` +
                    `that matches. Maybe you should implement a catch-all route with the path attribute of ".*"?`
            );
        }
        if (this.shownPage) {
            this.fragment.appendChild(this.shownPage);
            this.teardownElement(this.shownPage);
        }
        this.shownPage = element;
        this.appendChild(element);
        this.setupElement(element);

        this.dispatchEvent(new CustomEvent('route-changed'));
    }
    get location(): Location {
        return window.location;
    }

    set location(value: Location) {
        // no-op
    }

    disconnectedCallback() {
        window.removeEventListener('popstate', this.changedUrlListener);
        this.historyChangeStates.forEach(method => {
            window.history[method.name] = method;
        });
        if (this.shownPage) {
            this.teardownElement(this.shownPage);
        }
        this.unbindLinks();
        this.routeElements.clear();
    }

    clickedLink(link: HTMLAnchorElement, e: Event) {
        const { href } = link;
        if (!href || href.indexOf('mailto:') !== -1) return;

        const location = window.location;
        const origin = location.origin || location.protocol + '//' + location.host;
        if (href.indexOf(origin) !== 0) return;

        if (link.origin === this.location.origin) {
            e.preventDefault();
            const popStateEvent = new PopStateEvent('popstate', {});
            window.history.pushState({}, document.title, `${link.pathname}${link.search}`);
            this.changedUrl(popStateEvent);
        }
    }

    bindLinks() {
        // TODO: update this to be more performant
        // listening to body to allow detection inside of shadow roots
        this.clickedLinkListener = e => {
            if (e.defaultPrevented) return;
            const link = e.composedPath().filter(n => (n as HTMLElement).tagName === 'A')[0] as
                | HTMLAnchorElement
                | undefined;
            if (!link) {
                return;
            }
            this.clickedLink(link, e);
        };
        document.body.addEventListener('click', this.clickedLinkListener);
    }

    unbindLinks() {
        document.body.removeEventListener('click', this.clickedLinkListener);
    }

    private setupElement(element: Element) {
        this.originalDocumentTitle = document.title;
        const title = element.getAttribute('document-title');
        if (title) {
            document.title = title;
        } else {
            document.title = this.originalDocumentTitle;
        }
    }

    private teardownElement(element: Element) {
        document.title = this.originalDocumentTitle;
    }

    private getExternalRouterByPath(pathname: string): RouterComponent | undefined {
        for (const component of routeComponents) {
            const routeElement = component.getRouteElementByPath(pathname);
            if (routeElement) {
                return component;
            }
        }
    }
}

customElements.define('router-component', RouterComponent);
