export const isDiscordsaysFrame = (src: string, baseHref: string) => {
    try {
        return new URL(src, baseHref).host.endsWith(".discordsays.com");
    }
    catch {
        return false;
    }
};

export const wrapContentWindow = (contentWindow: Window, frameSrc: string) => {
    if (isDiscordsaysFrame(frameSrc, location.href)) {
        return contentWindow;
    }

    return new Proxy(contentWindow, {
        getOwnPropertyDescriptor: function (obj, prop) {
            if (prop === "localStorage") return undefined;
            return Object.getOwnPropertyDescriptor(obj, prop);
        },
        get: function (obj, prop) {
            if (prop === "localStorage") return null;
            const val = (obj as any)[prop];
            if (typeof val === "function") return val.bind(obj);
            return val;
        }
    });
};

export default function () {
    const contentWindowGetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow")!.get!;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        get: function (...args: any[]) {
            const contentWindow = Reflect.apply(contentWindowGetter, this, args);
            return wrapContentWindow(contentWindow, this.src);
        }
    });

    // Prevent interception by patching Reflect.apply and Function.prototype.bind
    Object.defineProperty(Reflect, "apply", {value: Reflect.apply, writable: false, configurable: false});
    Object.defineProperty(Function.prototype, "bind", {value: Function.prototype.bind, writable: false, configurable: false});
}
