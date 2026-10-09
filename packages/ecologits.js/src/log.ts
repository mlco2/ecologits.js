export type LogLevel = "debug" | "info" | "warning" | "error";

export type LogSink = (level: LogLevel, message: string) => void;

const defaultSink: LogSink = (level, message) => {
    if (level === "error") {
        console.error(message);
    } else if (level === "warning") {
        console.warn(message);
    }
};

export class EcoLogitsLogger {
    readonly name: string;
    private readonly onceMessages = new Set<string>();
    private sink: LogSink;

    constructor(name: string, sink: LogSink = defaultSink) {
        this.name = name;
        this.sink = sink;
    }

    /** Replace the output sink. Pass `null` to fall back to the default sink. */
    setSink(sink: LogSink | null): void {
        this.sink = sink ?? defaultSink;
    }

    private logOnce(level: LogLevel, message: string): void {
        if (this.onceMessages.has(message)) {
            return;
        }
        this.onceMessages.add(message);
        this.sink(level, message);
    }

    debug(message: string): void {
        this.sink("debug", message);
    }

    info(message: string): void {
        this.sink("info", message);
    }

    warning(message: string): void {
        this.sink("warning", message);
    }

    error(message: string): void {
        this.sink("error", message);
    }

    debugOnce(message: string): void {
        this.logOnce("debug", message);
    }

    infoOnce(message: string): void {
        this.logOnce("info", message);
    }

    warningOnce(message: string): void {
        this.logOnce("warning", message);
    }

    errorOnce(message: string): void {
        this.logOnce("error", message);
    }

    resetOnceMessages(): void {
        this.onceMessages.clear();
    }
}

export const logger = new EcoLogitsLogger("ecologits");
