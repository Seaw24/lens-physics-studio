export const SHOT_EVENT = {
  start: 13.5,
  end: 15.8,
  src: "/demo/basketball-event.mp4",
  poster: "/demo/coaching-frame.jpg",
};
export interface CoachQuestion {
  id: string;
  time: number;
  chapter: string;
  title: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
  hint: string;
  overlay: "force" | "apex" | "components";
  position: { x: number; y: number };
}
export const SHOT_QUESTIONS: CoachQuestion[] = [
  {
    id: "force",
    time: 14.7,
    chapter: "NEAR THE TOP OF THE ARC",
    title: "A pause in motion.\nA pause in force?",
    prompt:
      "Imagine this instant is the exact highest point. Ignoring air resistance, which way does the net force point?",
    options: ["Downward", "Upward", "There is no net force"],
    correct: 0,
    explanation:
      "Gravity never takes a break. Even when upward motion stops for an instant, the net force is still downward: Fnet = mg.",
    hint: "A force changes velocity. The ball is about to change from rising to falling. What is causing that change?",
    overlay: "force",
    position: { x: 0.493, y: 0.0625 },
  },
  {
    id: "velocity",
    time: 14.7,
    chapter: "SAME FRAME. A DIFFERENT QUESTION.",
    title: "What actually\nreaches zero?",
    prompt:
      "At the exact top of an angled shot, which quantity is zero in our ideal model?",
    options: [
      "Horizontal velocity",
      "Vertical velocity",
      "Gravitational acceleration",
    ],
    correct: 1,
    explanation:
      "Only vertical velocity is zero at the apex. The ball still travels horizontally, and gravity keeps accelerating it downward.",
    hint: "Split the motion into two directions. Which direction changes from upward to downward at the top?",
    overlay: "apex",
    position: { x: 0.493, y: 0.0625 },
  },
  {
    id: "horizontal",
    time: 15,
    chapter: "ON THE WAY DOWN",
    title: "One ball.\nTwo kinds of motion.",
    prompt:
      "As the ball falls, what happens to its horizontal velocity if we ignore air resistance?",
    options: ["It keeps increasing", "It drops to zero", "It stays constant"],
    correct: 2,
    explanation:
      "Gravity changes vertical velocity. With no horizontal net force, horizontal velocity stays constant throughout free flight.",
    hint: "Look at the direction of gravity. Does it have a horizontal component in our ground-based model?",
    overlay: "components",
    position: { x: 0.356, y: 0.135 },
  },
];
export function eventTime(absolute: number, start: number, end: number) {
  return Math.max(0, Math.min(end - start, absolute - start));
}
