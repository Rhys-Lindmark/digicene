export const ESSAY_SECTIONS = [
  {
    id: "arrival",
    label: "The arrival",
    excerpt:
      "We are building a new, hyperintelligent alien species on Earth. Soon Earth’s brainpower may be dominated by trillions of AI models rather than billions of humans.",
  },
  {
    id: "new-age",
    label: "A newest age",
    excerpt:
      "AI will shape Earth as humans shaped it during the Anthropocene. This book calls that coming age the Digicene and attempts to understand it.",
  },
  {
    id: "road-of-time",
    label: "The road of time",
    excerpt:
      "To understand the Digicene, travel further into the past, walking the road of time and asking each object how it came to be.",
  },
  {
    id: "evolution",
    label: "Evolution",
    excerpt:
      "Evolution—the selection of inherited variation—applies to all populations, not only animals, and can serve as a throughline.",
  },
  {
    id: "domestication",
    label: "Domestication",
    excerpt:
      "Humans domesticate more than organisms: fire, water, and soil. Repeated phenomena crystallize into useful, reproducible objects.",
  },
  {
    id: "four-parts",
    label: "Four parts",
    excerpt:
      "Each level builds on the last: atoms build life, life builds sapiens, sapiens build AI. The road has four parts: atoms, life, sapiens, and AI.",
  },
] as const;

export type SectionId = (typeof ESSAY_SECTIONS)[number]["id"];

export function getSection(id: string | null | undefined) {
  return (
    ESSAY_SECTIONS.find((section) => section.id === id) ?? ESSAY_SECTIONS[0]
  );
}
