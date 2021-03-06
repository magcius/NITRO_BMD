
import { assertExists, leftPad } from "./util";
import { Viewer, resizeCanvas } from "./viewer";
import { ZipFileEntry } from "./ZipFile";
import ArrayBufferSlice from "./ArrayBufferSlice";

type Callback = (viewer: Viewer, t: number, f: number) => boolean;

interface CaptureOptions {
    width: number;
    height: number;
    opaque: boolean;
    frameCount: number;
    filenamePrefix: string;
    setupCallback: Callback;
}

function convertCanvasToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(assertExists(b)), 'image/png'));
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    // In the future, just use blob.arrayBuffer()
    return await new Response(blob).arrayBuffer();
}

export async function captureScene(viewer: Viewer, options: CaptureOptions): Promise<ZipFileEntry[]> {
    const fileEntries: ZipFileEntry[] = [];

    // This is some ugliness to take over the main code... in an ideal world we'd do this offscreen...
    viewer.sceneTime = 0;
    viewer.rafTime = 0;
    for (let i = 0; i < options.frameCount; i++) {
        const t = i / (options.frameCount - 1);
        resizeCanvas(viewer.canvas, options.width, options.height, 1);
        if (!options.setupCallback(viewer, t, i))
            break;
        // Delay by waiting a frame on the microtask queue.
        await Promise.resolve();
        const canvas = viewer.takeScreenshotToCanvas(options.opaque);
        const blob = await convertCanvasToPNG(canvas);
        const data = new ArrayBufferSlice(await blobToArrayBuffer(blob));
        const filename = `${options.filenamePrefix}_${leftPad('' + i, 4)}.png`;
        fileEntries.push({ filename, data });
    }

    return fileEntries;
}
