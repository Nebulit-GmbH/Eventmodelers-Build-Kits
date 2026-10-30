// The board's player shows feedback only when the organization's plan includes it (it needs the license provider of the app). Locally the player always
// offers it: the platform decides when Submit reaches it — below the plan it discards what is sent.
export const useFeedbackEntitled = (): boolean => true
