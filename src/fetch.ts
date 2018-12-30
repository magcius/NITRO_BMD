
import ArrayBufferSlice from './ArrayBufferSlice';
import Progressable from './Progressable';

export const BASE_URL = `https://noclip.website/`;

export interface NamedArrayBufferSlice extends ArrayBufferSlice {
    name: string;
}

export function fetchData(url: string, abortSignal: AbortSignal | null = null): Progressable<NamedArrayBufferSlice> {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";
    request.send();
    if (abortSignal !== null) {
        abortSignal.addEventListener('abort', () => {
            request.abort();
        });
    }
    const p = new Promise<NamedArrayBufferSlice>((resolve, reject) => {
        request.onload = () => {
            pr.setProgress(1);
            let slice: NamedArrayBufferSlice;
            if (request.status !== 200) {
                slice = new ArrayBufferSlice(new ArrayBuffer(0)) as NamedArrayBufferSlice;
            } else {
                const buffer: ArrayBuffer = request.response;
                slice = new ArrayBufferSlice(buffer) as NamedArrayBufferSlice;
            }
            slice.name = url;
            resolve(slice);
        };
        request.onabort = () => {
            reject(400);
        };
        request.onerror = () => {
            reject();
        };
        request.onprogress = (e) => {
            if (e.lengthComputable)
                pr.setProgress(e.loaded / e.total);
        };
    });
    const pr = new Progressable<NamedArrayBufferSlice>(p);
    return pr;
}

function downloadHref(filename: string, href: string): void {
    const elem = document.createElement('a');
    elem.setAttribute('href', href);
    elem.setAttribute('download', filename);
    document.body.appendChild(elem);
    elem.click();
    document.body.removeChild(elem);
}

export function downloadBlob(filename: string, blob: Blob): void {
    const url = window.URL.createObjectURL(blob);
    downloadHref(filename, url);
    window.URL.revokeObjectURL(url);
}

export function downloadBuffer(filename: string, buffer: ArrayBufferSlice, type: string = 'application/octet-stream'): void {
    const blob = new Blob([buffer.castToBuffer()], { type });
    downloadBlob(filename, blob);
}
