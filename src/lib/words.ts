import { randomInt } from "crypto";

// Short, everyday words that are easy to say and spell at the exit desk.
const WORDS = [
  "apple", "mango", "lemon", "grape", "melon", "peach", "guava", "cocoa", "honey", "sugar",
  "bread", "pepper", "onion", "tomato", "yam", "rice", "beans", "plantain", "cashew", "coconut",
  "river", "ocean", "island", "valley", "forest", "desert", "garden", "meadow", "harbor", "canyon",
  "tiger", "zebra", "camel", "eagle", "falcon", "parrot", "dolphin", "turtle", "rabbit", "panda",
  "lion", "horse", "otter", "koala", "beaver", "pigeon", "salmon", "whale", "gecko", "bison",
  "silver", "golden", "copper", "amber", "coral", "ivory", "olive", "violet", "crimson", "indigo",
  "rocket", "planet", "comet", "galaxy", "meteor", "orbit", "lunar", "solar", "star", "cloud",
  "thunder", "breeze", "rain", "storm", "sunny", "frost", "rainbow", "sunset", "sunrise", "shadow",
  "piano", "guitar", "violin", "trumpet", "drum", "flute", "banjo", "cello", "harp", "bell",
  "castle", "bridge", "tower", "lantern", "window", "ladder", "basket", "candle", "mirror", "pillow",
  "anchor", "compass", "kettle", "teapot", "button", "ribbon", "pencil", "marble", "crayon", "magnet",
  "jungle", "safari", "voyage", "picnic", "parade", "festival", "market", "harvest", "journey", "puzzle",
  "bright", "gentle", "happy", "lucky", "quiet", "rapid", "brave", "clever", "jolly", "swift",
];

/** A random word to pair with the customer's phone number. */
export function newVerifyWord(): string {
  return WORDS[randomInt(WORDS.length)];
}

export const sameWord = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
