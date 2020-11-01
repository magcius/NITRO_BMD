// Implements Retro's ANCS format as seen in Metroid Prime 1.

import { assert } from "../util";

import { ResourceSystem } from "./resource";
import { CMDL } from "./cmdl";
import { InputStream } from "./stream";
import {
    AdditiveAnimation,
    Animation,
    AnimationSet,
    CreateMetaAnim,
    CreateMetaTrans,
    HalfTransition,
    Transition,
    TransitionDatabase
} from "./animation/meta_nodes";
import { CINF } from "./cinf";

// minimal implementation of character set entry
export interface MetroidCharacter {
    charID: number;
    name: string;
    model: CMDL | null;
    skel?: CINF;
    skinID: string;
    skelID: string;
    animNames: string[];
}

export interface ANCS {
    characterSet: MetroidCharacter[];
    animationSet: AnimationSet;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): ANCS {
    assert(stream.readUint16() == 1); // ANCS version
    assert(stream.readUint16() == 1); // character set version
    const numChars = stream.readUint32();
    const charSet: MetroidCharacter[] = [];

    for (let i = 0; i < numChars; i++) {
        const charID = stream.readUint32();
        const charVersion = stream.readUint16();
        const name = stream.readString();
        const modelID = stream.readAssetID();
        const skinID = stream.readAssetID();
        const skelID = stream.readAssetID();

        resourceSystem.registerModelSkin(modelID, skinID);
        const model = resourceSystem.loadAssetByID<CMDL>(modelID, "CMDL");
        const skel = resourceSystem.loadAssetByID<CINF>(skelID, "CINF");

        const numAnimNames = stream.readUint32();
        const animNames = new Array<string>(numAnimNames);

        for (let nameIdx = 0; nameIdx < numAnimNames; nameIdx++) {
            const animID = stream.readUint32();
            if (charVersion < 10) {
                const unk = stream.readString();
            }
            animNames[nameIdx] = stream.readString();
        }

        const char: MetroidCharacter = {charID, name, model, skel: skel ? skel : undefined, skinID, skelID, animNames};
        charSet.push(char);

        // we don't really care about the rest of the data, but have to parse it to reach the next character in the set
        const pas4 = stream.readFourCC();
        const numAnimStates = stream.readUint32();
        const defaultAnimState = stream.readUint32();
        assert(pas4 == "PAS4");

        for (let stateIdx = 0; stateIdx < numAnimStates; stateIdx++) {
            stream.skip(4);
            const parmInfoCount = stream.readUint32();
            const animInfoCount = stream.readUint32();

            let combinedParmSize = 0;

            for (let parmIdx = 0; parmIdx < parmInfoCount; parmIdx++) {
                const parmType = stream.readUint32();
                assert(parmType >= 0 && parmType <= 4);

                const parmValueSize = (parmType == 3 ? 1 : 4);
                stream.skip(8);
                stream.skip(parmValueSize * 2);
                combinedParmSize += parmValueSize;
            }

            stream.skip(animInfoCount * (4 + combinedParmSize));
        }

        const numGenericParticles = stream.readUint32();
        stream.skip(4 * numGenericParticles);
        const numSwooshParticles = stream.readUint32();
        stream.skip(4 * numSwooshParticles);

        if (charVersion >= 6) {
            stream.skip(4);
        }

        const numElectricParticles = stream.readUint32();
        stream.skip(4 * numElectricParticles);

        if (charVersion >= 10) {
            const numSpawnParticles = stream.readUint32();
            stream.skip(4 * numSpawnParticles);
        }

        stream.skip(4);
        if (charVersion >= 10) {
            stream.skip(4);
        }

        if (charVersion >= 2) {
            const numAnimBounds = stream.readUint32();

            for (let animIdx = 0; animIdx < numAnimBounds; animIdx++) {
                const animName = stream.readString();
                stream.skip(0x18);
            }

            const numEffects = stream.readUint32();

            for (let effectIdx = 0; effectIdx < numEffects; effectIdx++) {
                const effectName = stream.readString();
                const numComponents = stream.readUint32();

                for (let componentIdx = 0; componentIdx < numComponents; componentIdx++) {
                    const componentName = stream.readString();
                    stream.skip(8);
                    // Bone name in MP1, bone ID in MP2
                    if (charVersion >= 10) {
                        stream.skip(4);
                    } else {
                        const locatorBoneName = stream.readString();
                    }
                    stream.skip(12);
                }
            }

            if (charVersion >= 4) {
                const frozenModelID = stream.readAssetID();
                const frozenSkinID = stream.readAssetID();

                if (charVersion >= 5) {
                    const animCount = stream.readUint32();
                    stream.skip(animCount * 4);

                    if (charVersion >= 10) {
                        stream.skip(5);
                        const indexedBoundsCount = stream.readUint32();
                        stream.skip(0x1C * indexedBoundsCount);
                    }
                }
            }
        }
    }

    const animSetVersion = stream.readUint16();

    const numAnims = stream.readUint32();
    const animations: Animation[] = new Array(numAnims);
    for (let i = 0; i < numAnims; i++) {
        const name = stream.readString();
        const anim = CreateMetaAnim(stream);
        animations[i] = {name: name, animation: anim};
    }

    const numTrans = stream.readUint32();
    const transitions: Transition[] = new Array(numTrans);
    for (let i = 0; i < numTrans; i++) {
        stream.readUint32();
        const a = stream.readUint32();
        const b = stream.readUint32();
        const trans = CreateMetaTrans(stream);
        transitions[i] = {a: a, b: b, transition: trans};
    }

    const defaultTransition = CreateMetaTrans(stream);

    let additiveAnims: AdditiveAnimation[] = [];

    let defaultFadeInTime = 0.0;
    let defaultFadeOutTime = 0.0;

    let halfTransitions: HalfTransition[] = [];

    if (animSetVersion > 1) {
        const numAdditiveAnims = stream.readUint32();
        additiveAnims = new Array(numAdditiveAnims);
        for (let i = 0; i < numAdditiveAnims; i++) {
            const animIdx = stream.readUint32();
            const fadeInTime = stream.readFloat32();
            const fadeOutTime = stream.readFloat32();
            additiveAnims[i] = {animIdx: animIdx, fadeInTime: fadeInTime, fadeOutTime: fadeOutTime};
        }
        defaultFadeInTime = stream.readFloat32();
        defaultFadeOutTime = stream.readFloat32();

        if (animSetVersion > 2) {
            const numHalfTrans = stream.readUint32();
            halfTransitions = new Array(numHalfTrans);
            for (let i = 0; i < numHalfTrans; i++) {
                const b = stream.readUint32();
                const trans = CreateMetaTrans(stream);
                halfTransitions[i] = {b: b, transition: trans};
            }
        }
    }


    return {
        characterSet: charSet, animationSet: {
            animations: animations, additiveAnimations: additiveAnims,
            defaultAdditiveFadeInTime: defaultFadeInTime, defaultAdditiveFadeOutTime: defaultFadeOutTime,
            transitionDatabase: new TransitionDatabase(defaultTransition, transitions, halfTransitions)
        }
    };
}
