import { Bot, FileDiff, Folder, Globe, MessageCircleQuestion, NotebookPen, ScrollText, SquareTerminal } from 'lucide-react';

/** The rail's icons for Seshboard's own tools, shared by a session here and one on another computer. */
export const RAIL_ICONS = {
  files: <Folder size={17} aria-hidden />,
  changes: <FileDiff size={17} aria-hidden />,
  terminal: <SquareTerminal size={17} aria-hidden />,
  web: <Globe size={17} aria-hidden />,
  ask: <MessageCircleQuestion size={17} aria-hidden />,
  agents: <Bot size={17} aria-hidden />,
  commands: <ScrollText size={17} aria-hidden />,
  note: <NotebookPen size={17} aria-hidden />,
};
