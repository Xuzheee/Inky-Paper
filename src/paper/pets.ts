export const paperPets = [
  { id: "fish", name: "小鱼 Inky", src: "/inky-paper-pet.png" },
  { id: "jelly", name: "抱星水母", src: "/paper-assets/pets/star-jelly-app.png" },
  { id: "mushroom", name: "蘑菇小灵", src: "/paper-assets/pets/mushroom-spirit-app.png" },
  { id: "bunny", name: "抱月兔子", src: "/paper-assets/pets/cloud-bunny-app.png" },
] as const;

export function findPaperPet(id: unknown) {
  return paperPets.find((pet) => pet.id === id) ?? paperPets[0];
}
