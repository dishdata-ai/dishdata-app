export interface TourStep {
  /** data-tour attribute value to spotlight; null = centered welcome card. */
  target: string | null;
  title: string;
  body: string;
}

export const TOUR_DONE_KEY = "dishdata:tour-done";

export const TOUR_STEPS: TourStep[] = [
  {
    target: null,
    title: "Welcome to DishData 👋",
    body: "Your restaurant's command center. This 30-second tour shows you where everything lives — you can replay it anytime from the account menu.",
  },
  {
    target: "nav-pos",
    title: "Ring up orders",
    body: "The Point of Sale handles dine-in, takeaway and delivery — tips, split bills and all. Every sale flows straight into your analytics.",
  },
  {
    target: "nav-kitchen",
    title: "The kitchen sees it instantly",
    body: "Every order — from the POS or a guest scanning a table QR code — lands on the live kitchen ticket board with timers and notes.",
  },
  {
    target: "nav-inventory",
    title: "Stock that tracks itself",
    body: "Selling a dish automatically depletes its linked ingredients. Par levels, expiry dates and waste logging keep food cost honest.",
  },
  {
    target: "nav-insights",
    title: "Insights, computed live",
    body: "DishData watches your margins, stock depletion and sales mix, then tells you what to fix first — with the monthly impact in dollars.",
  },
  {
    target: "nav-settings",
    title: "Make it yours",
    body: "Branding, tax rate, targets and enabled modules live in Settings. Admins control each team member's module access in Team & Access.",
  },
  {
    target: "user-menu",
    title: "You're all set",
    body: "That's the lay of the land. Invite your team, load your menu, and let the data do the talking. Bon appétit! 🍽️",
  },
];
