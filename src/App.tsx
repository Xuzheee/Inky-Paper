import PaperApp from "./paper/PaperApp";
import { CoachPrompt } from "./paper/CoachUI";
import PaperNotice from "./paper/PaperNotice";
import Workbench from "./workbench/Workbench";
const params = new URLSearchParams(window.location.search);
export default params.has("workbench")
  ? Workbench
  : params.has("paperNotice")
    ? PaperNotice
    : params.has("coachPrompt")
      ? CoachPrompt
      : PaperApp;
