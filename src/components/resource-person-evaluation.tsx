"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { collectionGroup, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { Eye, EyeOff, Printer, X } from "lucide-react";
import { db, Program, ResourcePersonEvaluation, UserProfile, PersonProfileCard } from "@/lib/firebase";

const ratingChoices = [5, 4, 3, 2, 1, "NA"] as const;
type Rating = (typeof ratingChoices)[number];

const ratingQuestions = [
  "Displayed a thorough knowledge of the topic and was able to provide insights",
  "Thoroughly explained and processed the learning activities throughout the training",
  "Able to create a good learning environment, sustained the attention of the participants, and encouraged their participation in the training duration",
  "Able to manage her/his time well, including some adjustments in the training schedule, if needed",
  "Demonstrated keenness to the participants' needs and other requirements related to the training",
];

function fullProfileName(profile: UserProfile) {
  return [profile.firstName, profile.middleName, profile.lastName, profile.suffix].map((part) => part?.trim()).filter(Boolean).join(" ");
}

function formatDate(date: string) {
  if (!date) return "Date to be announced";
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" }).format(parsed);
}

function formatDateRange(dateFrom: string, dateTo: string) {
  if (!dateFrom && !dateTo) return "Date to be announced";
  if (!dateFrom) return formatDate(dateTo);
  if (!dateTo || dateFrom === dateTo) return formatDate(dateFrom);
  return `${formatDate(dateFrom)} – ${formatDate(dateTo)}`;
}

function sessionTitles(value: string) {
  return value.split(/\s*;\s*/).map((session) => session.trim()).filter(Boolean);
}

function evaluationPath(programId: string, speakerId: string, respondentUid: string) {
  return doc(db, "resourcePersonEvaluations", programId, "speakers", speakerId, "rpSubmissions", respondentUid);
}

export function ResourcePersonRatingModal({ speaker, programs, respondentUid, respondentKind, profile, onClose, onSubmitted }: {
  speaker: PersonProfileCard;
  programs: Program[];
  respondentUid: string;
  respondentKind: "member" | "guest";
  profile: UserProfile | null;
  onClose: () => void;
  onSubmitted: (speakerId: string) => void;
}) {
  const [programId, setProgramId] = useState(() => programs.some((program) => program.id === speaker.programId) ? speaker.programId : programs[0]?.id ?? "");
  const [ratings, setRatings] = useState<Array<Rating | null>>(() => Array(ratingQuestions.length).fill(null));
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(true);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedProgram = programs.find((program) => program.id === programId) ?? null;
  const sessionTitle = (speaker.keynoteSessions ?? []).map((session) => session.session.trim()).filter(Boolean).join("; ");
  const memberName = profile ? fullProfileName(profile) : "";

  useEffect(() => {
    if (!programId || !respondentUid) {
      setChecking(false);
      setAlreadySubmitted(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    setAlreadySubmitted(false);
    void getDoc(evaluationPath(programId, speaker.id, respondentUid))
      .then((snapshot) => { if (!cancelled) setAlreadySubmitted(snapshot.exists()); })
      .catch(() => { if (!cancelled) setNotice("Could not check for a previous response. Check your connection and try again."); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [programId, respondentUid, speaker.id]);

  async function submitEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !selectedProgram || !respondentUid) return;
    if (ratings.some((rating) => rating === null)) {
      setNotice("Choose one rating for each criterion.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const respondentName = respondentKind === "member" ? memberName : String(form.get("respondentName") ?? "").trim();
    const respondentSexAtBirth = respondentKind === "member" ? profile?.sexAtBirth : String(form.get("respondentSexAtBirth") ?? "");
    const respondentAgency = respondentKind === "member" ? profile?.office?.trim() : String(form.get("respondentAgency") ?? "").trim();
    if (respondentKind === "member" && !profile) {
      setNotice("Your user profile is not available. Refresh the page and try again.");
      return;
    }
    if (!respondentName || (respondentSexAtBirth !== "Male" && respondentSexAtBirth !== "Female") || !respondentAgency) {
      setNotice("Complete your name, sex at birth, and agency details before submitting.");
      return;
    }

    setSaving(true);
    setNotice("");
    const data: Omit<ResourcePersonEvaluation, "id"> = {
      programId: selectedProgram.id,
      programTitle: selectedProgram.eventTitle,
      dateFrom: selectedProgram.dateFrom,
      dateTo: selectedProgram.dateTo,
      venue: selectedProgram.venue,
      speakerId: speaker.id,
      speakerName: speaker.name,
      sessionTitle,
      respondentUid,
      respondentKind,
      respondentName,
      respondentFirstName: respondentKind === "member" ? profile?.firstName ?? "" : "",
      respondentMiddleName: respondentKind === "member" ? profile?.middleName ?? "" : "",
      respondentLastName: respondentKind === "member" ? profile?.lastName ?? "" : "",
      respondentSuffix: respondentKind === "member" ? profile?.suffix ?? "" : "",
      respondentSexAtBirth: respondentSexAtBirth as "Male" | "Female",
      respondentAgency,
      ratings: ratings as Rating[],
      otherComments: String(form.get("otherComments") ?? "").trim().slice(0, 2000),
      submittedAt: serverTimestamp(),
    };

    try {
      // Responses are stored in independent respondent documents. Spread a synchronized
      // event-wide submit burst briefly, as the CSM form does, before writing to Firestore.
      await new Promise((resolve) => window.setTimeout(resolve, Math.random() * 3000));
      await setDoc(evaluationPath(selectedProgram.id, speaker.id, respondentUid), data);
      onSubmitted(speaker.id);
    } catch {
      const existing = await getDoc(evaluationPath(selectedProgram.id, speaker.id, respondentUid)).catch(() => null);
      if (existing?.exists()) {
        setAlreadySubmitted(true);
        setNotice("A response for this speaker and program has already been submitted from this account.");
      } else {
        setNotice("The evaluation could not be saved. Check your connection and try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop evaluation-backdrop rp-evaluation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape" && !saving) onClose(); }}>
    <section className="form-modal evaluation-modal rp-evaluation-modal" role="dialog" aria-modal="true" aria-labelledby="rp-evaluation-title">
      <div className="form-modal-head"><div><span className="eyebrow">TRAINING EFFECTIVENESS EVALUATION TOOLS</span><h2 id="rp-evaluation-title">Resource Person <i>Evaluation</i><span>.</span></h2><p>Rate the resource person’s delivery of this training or program.</p></div><button type="button" className="modal-close modal-close--inline" onClick={() => !saving && onClose()} aria-label="Close RP evaluation"><X size={19} /></button></div>
      <form className="evaluation-form rp-evaluation-form" onSubmit={submitEvaluation}>
        {!selectedProgram && <p className="evaluation-notice" role="alert">No saved programs are available for evaluation.</p>}
        {respondentKind === "guest" && <div className="rp-respondent-row">
          <label className="evaluation-field"><span className="evaluation-field-label">Name of Participant / Respondent</span><input name="respondentName" autoComplete="name" maxLength={180} required disabled={saving || alreadySubmitted} /></label>
          <label className="evaluation-field"><span className="evaluation-field-label">Sex at Birth</span><select name="respondentSexAtBirth" defaultValue="" required disabled={saving || alreadySubmitted}><option value="" disabled>Select</option><option value="Male">Male</option><option value="Female">Female</option></select></label>
          <label className="evaluation-field"><span className="evaluation-field-label">Participant’s / Respondent’s Agency / Division / Unit</span><input name="respondentAgency" maxLength={240} required disabled={saving || alreadySubmitted} /></label>
        </div>}
        <label className="evaluation-field rp-program-field"><span className="evaluation-field-label">Program</span><select name="programId" value={programId} onChange={(event) => setProgramId(event.target.value)} required disabled={saving || alreadySubmitted || !programs.length}><option value="" disabled>Select a saved program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.eventTitle}</option>)}</select></label>
        <p className="rp-hidden-info" aria-hidden="true">Respondent, activity date and venue, speaker, and session are added automatically to the evaluation record.</p>
        <div className="rp-rating-list">
          {ratingQuestions.map((question, index) => <fieldset className="rp-rating-question" key={question}>
            <legend><strong>{index + 1}.</strong> {question}</legend>
            <div className="rp-rating-options">{ratingChoices.map((choice) => <label className="rp-rating-option" key={choice}>
              <input type="radio" name={`rp-rating-${index}`} value={choice} checked={ratings[index] === choice} required onChange={() => setRatings((current) => current.map((rating, ratingIndex) => ratingIndex === index ? choice : rating))} disabled={saving || alreadySubmitted} />
              <span>{choice}</span>
            </label>)}</div>
          </fieldset>)}
        </div>
        <label className="evaluation-field rp-comments-field"><span className="evaluation-field-label">Other Comments</span><textarea name="otherComments" rows={4} maxLength={2000} placeholder="Share any additional comments or observations." disabled={saving || alreadySubmitted} /></label>
        {checking && <p className="evaluation-helper" role="status">Checking previous responses…</p>}
        {alreadySubmitted && <p className="evaluation-notice" role="status">A response for this speaker and program has already been submitted from this account.</p>}
        {notice && <p className="evaluation-notice" role="alert">{notice}</p>}
        <div className="evaluation-actions rp-evaluation-actions"><button className="button button--soft" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button button--olive" type="submit" disabled={saving || checking || alreadySubmitted || !selectedProgram}>{saving ? "Submitting…" : "Submit Evaluation"}</button></div>
      </form>
    </section>
  </div>;
}

function PrintEvaluationForm({ evaluation }: { evaluation: ResourcePersonEvaluation }) {
  const activityDates = formatDateRange(evaluation.dateFrom, evaluation.dateTo);
  return <section className="rp-evaluation-print-page" key={evaluation.id}>
    <img className="rp-evaluation-print-frame" src="/a4_size_header_footer.jpg" alt="" />
    <article className="rp-evaluation-print-content">
      <h1>TRAINING EFFECTIVENESS EVALUATION TOOLS<br />RESOURCE PERSON (RP) EVALUATION FORM</h1>
      <p className="rp-print-dear">Dear Participant:</p>
      <p className="rp-print-intro">The Department of Agriculture – Regional Office XIII values your comments/insights/observations in the delivery of this training/program titled <strong>“{evaluation.programTitle}”.</strong> As part of our continuous effort to improve the delivery of our training programs, we are providing you with this Resource Person (RP) Evaluation Form to rate <strong><u>{evaluation.speakerName}</u></strong> as Trainer/Resource Person. Rest assured, we shall treat your responses with utmost confidentiality. Thank you for your cooperation!</p>
      <h2>I. Participant’s Information</h2>
      <table className="rp-print-info-table"><tbody>
        <tr><th>Name of Participant/Respondent</th><td><strong>{evaluation.respondentName}</strong></td></tr>
        <tr><th>Sex at Birth</th><td><strong>{evaluation.respondentSexAtBirth}</strong></td></tr>
        <tr><th>Participant’s / Respondent’s Agency / Division / Unit</th><td><strong>{evaluation.respondentAgency}</strong></td></tr>
        <tr><th>Date and Venue of Activity</th><td><strong>{activityDates} | {evaluation.venue}</strong></td></tr>
      </tbody></table>
      <h2>II. Resource Person Information</h2>
      <table className="rp-print-info-table rp-print-speaker-table"><tbody>
        <tr><th>Name</th><td><strong>{evaluation.speakerName}</strong></td></tr>
        <tr><th>Title of Session</th><td><strong>{evaluation.sessionTitle || "—"}</strong></td></tr>
      </tbody></table>
      <p className="rp-print-instruction">Please rate each criterion on a progressive scale of 1 to 5 <i>(1-Poor; 2-Unsatisfactory; 3-Satisfactory; 4-Very Satisfactory; 5-Outstanding)</i> by checking the number you preferred:</p>
      <table className="rp-print-rating-table"><colgroup><col /><col span={6} /></colgroup><thead><tr><th rowSpan={2}>Criteria</th><th colSpan={6}>Rating</th></tr><tr>{ratingChoices.map((choice) => <th key={choice}>{choice}</th>)}</tr></thead><tbody>
        {ratingQuestions.map((question, index) => <tr key={question}><td>{index + 1}. {question}</td>{ratingChoices.map((choice) => <td className="rp-print-rating-cell" key={choice}>{evaluation.ratings[index] === choice ? "✓" : ""}</td>)}</tr>)}
      </tbody></table>
      <h2 className="rp-print-comments-heading">Other Comments:</h2>
      <div className="rp-print-comments">{evaluation.otherComments || ""}</div>
      <p className="rp-print-note"><strong>Note:</strong> Please submit the completed RP Evaluation Form to the Training Secretariat. Thank you very much!</p>
    </article>
  </section>;
}

export function ResourcePersonEvaluationPage({ programs, speakers, onToggleRateVisibility }: { programs: Program[]; speakers: PersonProfileCard[]; onToggleRateVisibility: (program: Program) => Promise<void> }) {
  const [evaluations, setEvaluations] = useState<ResourcePersonEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionFilters, setSessionFilters] = useState<Record<string, string>>({});
  const [printingSelection, setPrintingSelection] = useState<{ program: Program; session: string } | null>(null);
  const [updatingProgramId, setUpdatingProgramId] = useState("");
  const printEvaluations = useMemo(() => {
    if (!printingSelection) return [];
    return evaluations
      .filter((evaluation) => evaluation.programId === printingSelection.program.id
        && (!printingSelection.session || sessionTitles(evaluation.sessionTitle).includes(printingSelection.session)))
      .map((evaluation) => printingSelection.session ? { ...evaluation, sessionTitle: printingSelection.session } : evaluation)
      .sort((a, b) => a.speakerName.localeCompare(b.speakerName) || a.respondentName.localeCompare(b.respondentName));
  }, [evaluations, printingSelection]);

  useEffect(() => onSnapshot(collectionGroup(db, "rpSubmissions"), (snapshot) => {
    const next = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as ResourcePersonEvaluation));
    setEvaluations(next);
    setError("");
    setLoading(false);
  }, () => {
    setError("RP evaluation responses could not be loaded. Check the Firestore rules and your admin access.");
    setLoading(false);
  }), []);

  useEffect(() => {
    if (!printingSelection) return;
    let cancelled = false;
    const style = document.createElement("style");
    style.media = "print";
    style.textContent = "@page { size: A4 portrait; margin: 0; }";
    document.head.appendChild(style);
    const afterPrint = () => setPrintingSelection(null);
    window.addEventListener("afterprint", afterPrint, { once: true });
    const images = Array.from(document.querySelectorAll<HTMLImageElement>(".rp-evaluation-print-frame"));
    void Promise.all(images.map((image) => image.decode().catch(() => undefined))).then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
      style.remove();
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [printingSelection]);

  const sortedPrograms = [...programs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom) || a.eventTitle.localeCompare(b.eventTitle));
  const sessionOptionsByProgram = new Map<string, Set<string>>();
  function addSessionOption(programId: string, session: string) {
    const title = session.trim();
    if (!title) return;
    const options = sessionOptionsByProgram.get(programId) ?? new Set<string>();
    options.add(title);
    sessionOptionsByProgram.set(programId, options);
  }
  speakers.filter((speaker) => (speaker.type ?? "Speaker") === "Speaker")
    .forEach((speaker) => (speaker.keynoteSessions ?? []).forEach((session) => addSessionOption(speaker.programId, session.session)));
  evaluations.forEach((evaluation) => sessionTitles(evaluation.sessionTitle).forEach((session) => addSessionOption(evaluation.programId, session)));

  async function toggleRateVisibility(program: Program) {
    if (updatingProgramId) return;
    setUpdatingProgramId(program.id);
    try { await onToggleRateVisibility(program); }
    finally { setUpdatingProgramId(""); }
  }

  return <>
    <section className="content-wrap dashboard-page rp-evaluation-page">
      <div className="section-heading"><div><span className="eyebrow">ADMIN WORKSPACE</span><h2>RP <span>Evaluation</span></h2><p>Review and print submitted Resource Person Evaluation forms by program.</p></div></div>
      {error && <p className="rp-evaluation-error" role="alert">{error}</p>}
      <div className="approval-panel rp-evaluation-panel">
        <div className="panel-heading"><div><span className="eyebrow">RESOURCE PERSON EVALUATIONS</span><h2>Program Forms</h2><p>Choose a keynote session to filter the forms included in Print.</p></div></div>
        <div className="approval-table-wrap"><table className="approval-table rp-evaluation-program-table"><thead><tr><th>PROGRAM</th><th>DATE</th><th>VENUE</th><th>SESSION</th><th>PRINT</th></tr></thead><tbody>
          {sortedPrograms.map((program) => {
            const selectedSession = sessionFilters[program.id] ?? "";
            const programEvaluations = evaluations.filter((evaluation) => evaluation.programId === program.id);
            const count = programEvaluations.filter((evaluation) => !selectedSession || sessionTitles(evaluation.sessionTitle).includes(selectedSession)).length;
            const sessions = [...(sessionOptionsByProgram.get(program.id) ?? [])].sort((a, b) => a.localeCompare(b));
            const revealed = program.rpEvaluationRevealed === true;
            return <tr key={program.id}><td><strong className="table-primary">{program.eventTitle}</strong></td><td>{formatDateRange(program.dateFrom, program.dateTo)}</td><td>{program.venue}</td><td><select className="rp-evaluation-session-select" aria-label={`Session filter for ${program.eventTitle}`} value={selectedSession} onChange={(event) => setSessionFilters((current) => ({ ...current, [program.id]: event.target.value }))}><option value="">All Sessions</option>{sessions.map((session) => <option value={session} key={session}>{session}</option>)}</select></td><td><div className="rp-evaluation-row-actions"><button type="button" className={`button button--soft rp-evaluation-reveal-button${revealed ? " rp-evaluation-reveal-button--active" : ""}`} disabled={updatingProgramId === program.id} aria-pressed={revealed} onClick={() => void toggleRateVisibility(program)}>{revealed ? <EyeOff size={15} /> : <Eye size={15} />}{revealed ? "Unreveal Rate" : "Reveal Rate"}</button><button type="button" className="button button--soft rp-evaluation-print-button" disabled={loading || count === 0} title={count ? `Print ${count} RP evaluation ${count === 1 ? "form" : "forms"}` : "No matching RP evaluation forms have been submitted"} onClick={() => setPrintingSelection({ program, session: selectedSession })}><Printer size={15} />Print{count > 0 && <span>{count}</span>}</button></div></td></tr>;
          })}
          {!sortedPrograms.length && <tr><td colSpan={5} className="empty-table">No saved programs are available.</td></tr>}
        </tbody></table></div>
        <div className="table-footnote"><span>{loading ? "Loading RP evaluations…" : `${evaluations.length} ${evaluations.length === 1 ? "submitted form" : "submitted forms"}`}</span></div>
      </div>
    </section>
    {printingSelection && printEvaluations.length > 0 && typeof document !== "undefined" && createPortal(<div className="rp-evaluation-print" style={{ height: `calc(${printEvaluations.length * 297}mm - 1px)` }} aria-hidden="true">{printEvaluations.map((evaluation) => <PrintEvaluationForm evaluation={evaluation} key={evaluation.id} />)}</div>, document.body)}
  </>;
}
