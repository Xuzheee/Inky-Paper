import PaperApp from "./paper/PaperApp";
import { CoachPrompt } from "./paper/CoachUI";
export default new URLSearchParams(window.location.search).has("coachPrompt")
  ? CoachPrompt
  : PaperApp;
