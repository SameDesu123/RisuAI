import { bench, group, run } from 'mitata';

const char = {
    globalLore: Array.from({ length: 10000 }).map((_, i) => ({
        content: i % 2 === 0 ? `content_${i}` : undefined,
        comment: i % 3 === 0 ? `comment_${i}` : undefined
    }))
};

group('v2GetAllLorebooks', () => {
    bench('baseline', () => {
        const globalLore = char.globalLore ?? [];
        return globalLore
            .filter(lore => lore && lore.content !== undefined)
            .map(lore => lore.content);
    });

    bench('optimized', () => {
        const globalLore = char.globalLore ?? [];
        const allPrompts = [];
        for (const lore of globalLore) {
            if (lore && lore.content !== undefined) {
                allPrompts.push(lore.content);
            }
        }
        return allPrompts;
    });
});

const regex = new RegExp('comment_0', 'i');

group('v2GetLorebookByName', () => {
    bench('baseline', () => {
        const globalLore = char.globalLore ?? [];
        return globalLore
            .map((lore, index) => {
                if(lore && lore.comment !== undefined && regex.test(lore.comment)){
                    return index;
                }
                return -1;
            })
            .filter(index => index !== -1);
    });

    bench('optimized', () => {
        const globalLore = char.globalLore ?? [];
        const matchingIndices = [];
        for (let i = 0; i < globalLore.length; i++) {
            const lore = globalLore[i];
            if (lore && lore.comment !== undefined && regex.test(lore.comment)) {
                matchingIndices.push(i);
            }
        }
        return matchingIndices;
    });
});

run();
