import PaperApp from "./paper/PaperApp";
import { CoachPrompt } from "./paper/CoachUI";
import PaperNotice from "./paper/PaperNotice";
const params = new URLSearchParams(window.location.search);
export default params.has("paperNotice")
  ? PaperNotice
  : params.has("coachPrompt")
    ? CoachPrompt
    : PaperApp;
