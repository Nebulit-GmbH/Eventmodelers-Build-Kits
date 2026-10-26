// Local stand-in for the board's node store: the player only asks which board is open.
export const useNodeStore = <T,>(select: (s: { currentBoardId: string | null }) => T): T => select({ currentBoardId: 'local' })
