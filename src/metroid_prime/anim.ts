import { InputStream } from "./stream";
import { ResourceGame, ResourceSystem } from "./resource";
import { AnimSource, AnimSourceCompressed } from "./animation/data_source";

export interface ANIM {
    source: AnimSource | AnimSourceCompressed
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): ANIM {
    switch (resourceSystem.game) {
        case ResourceGame.MP1:
        case ResourceGame.MP2: {
            const version = stream.readUint32();
            const mp2 = resourceSystem.game === ResourceGame.MP2;
            if (version === 0)
                return {source: new AnimSource(stream, resourceSystem, mp2)};
            else if (version === 2)
                return {source: new AnimSourceCompressed(stream, resourceSystem, mp2)};
        }
    }

    throw "unsupported game ANIM";
}
