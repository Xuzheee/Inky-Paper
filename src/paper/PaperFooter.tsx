export function PaperFooter({
  pet,
  petName,
  motto,
  openPet,
}: {
  pet: string;
  petName: string;
  motto: string;
  openPet: () => void;
}) {
  return (
    <footer className="paper-footer">
      <button
        className="pet-button"
        aria-label="进入迷你宠物"
        onClick={openPet}
      >
        <img src={pet} alt={petName} />
      </button>
      <span className="paper-motto" lang="en">
        {motto}
      </span>
    </footer>
  );
}
