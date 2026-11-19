import { createContext } from 'react';

/**
 * True inside the block of a reply Claude is still writing (`StreamingMarkdown`'s last one), false everywhere else.
 * A block that is only partly there can't be drawn as it will be: a Mermaid diagram waits for it, and shows its source
 * meanwhile, instead of drawing half a diagram or a parse error that goes away with the next line.
 */
export const BlockWritingContext = createContext(false);
