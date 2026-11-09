"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { ArrowRight, Check, Printer, Search, X } from "lucide-react";
import { db, Program, ProgramEvaluation } from "@/lib/firebase";

const clientTypes = ["Lungsuranon (citizen)", "Negasyo", "Gobyerno (empleyado o sa ubang ahensya)"];
const independentCitiesCode = "__independent_cities__";
type PSGCRegionOption = { code: string; name: string };
type PSGCBarangay = [string, string, string?];
type PSGCCity = { code: string; name: string; type: "city" | "municipality"; barangays: PSGCBarangay[] };
type PSGCProvince = { code: string; name: string; cities: PSGCCity[] };
type PSGCIndependentCity = { code: string; name: string; type: "city" | "municipality"; barangays: PSGCBarangay[] };
type PSGCRegionData = { code: string; provinces: PSGCProvince[]; independentCities: PSGCIndependentCity[] };
const individualBeneficiaries = ["Mag-uuma", "Mangingisda", "AEW", "Uban pa"];
const groupBeneficiaries = ["FCA", "Cluster", "LGU", "Eskwelahan", "Uban pa"];
const receivedServices = ["Suporta sa Produksyon", "Pagbansay", "Serbisyong Pangmerkado", "Serbisyong Irigasyon", "Ekipo / Makinarya / Pasilidad", "Uban pa"];
const cc1Choices = [
  "Nasayud ko unsa ang CC ug nakita ko ang maong CC niining opisinaha.",
  "Nasayud ko unsa ang CC apan WALA ko makita ang maong CC niining opisinaha.",
  "Nasayud lang ko bahin sa CC dihang nakita ko ang maong CC niining opisinaha.",
  "Wala ko nasayud unsa ang CC ug wa ko kini makita niining opisinaha.",
];
const cc2Choices = ["Dali makita", "Medyo dali nga makita", "Lisod makita", "Di gyud makita", "N/A"];
const cc3Choices = ["Dako kaayo ug gikatabang", "Medyo nakatabang", "Wa gyud makatabang", "N/A"];
const agreementChoices = ["Hugot nga Pagsupak", "Supak", "Way Paboran", "Uyon", "Hugot nga Pag-uyon"];

const qualityQuestions = [
  "Migahin ko og makatarunganon nga panahon aron pagkuha sa serbisyo/interbensyon nga gikinahanglan/gihangyo.",
  "Ang serbisyo/interbensyon nga akong nadawat mao gayud ang akong kinahanglan ug sibo sa gisaad, subay sa mga pamaagi nga gilatid sa DA.",
  "Ang opisina sa DA dali lamang nga duolon ug makontak, hinungdan nga dali ra ko naka-access ug nakadawat sa serbisyo/interbensyon.",
  "Gipahibalo ko sa gamit, benepisyo, ug uban pang gilauman nga resulta sa serbisyo/interbensyon nga akong nadawat, ug naminaw sila sa akong feedback.",
  "Ako mibayad sa makatarunganon nga bayrunon alang sa serbisyo/interbensyon nga akong nadawat (ayaw kini graduhi kung libre ang serbisyo/interbensyon).",
  "Akong gibati nga patas ang DA sa matag usa, o walay palakasan, sa paghatag sa serbisyo/interbensyon.",
  "Ako giabi-abi nga matinahuron sa staff sa DA (kung nangayo og tabang ang DA staff matinabangon).",
  "Nakuha ko ang akong gikinahanglan sa DA, o (kung wala) gipasabot ko og maayo nganong wala mahatag ang akong hangyo.",
];

function value(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function formatContactNumber(input: string) {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("639") && digits.length > 9) digits = digits.slice(3);
  else if (digits.startsWith("09") && digits.length > 9) digits = digits.slice(2);
  else if (digits.startsWith("9") && digits.length > 9) digits = digits.slice(1);
  digits = digits.slice(0, 9);
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 9)].filter(Boolean).join(" ");
}

function fullRespondentName(form: FormData, beneficiaryType: string) {
  if (beneficiaryType === "Grupo") return value(form, "groupName");
  return [value(form, "firstName"), value(form, "middleName"), value(form, "lastName"), value(form, "suffix")]
    .filter(Boolean)
    .join(" ");
}

export function ProgramEvaluationModal({ program, respondentUid, respondentKind, onClose, onSubmitted }: {
  program: Program;
  respondentUid: string;
  respondentKind: "member" | "guest";
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [isMobileLayout, setIsMobileLayout] = useState<boolean | null>(null);
  const [selectedClientType, setSelectedClientType] = useState("");
  const [beneficiaryType, setBeneficiaryType] = useState("");
  const [beneficiaryCategory, setBeneficiaryCategory] = useState("");
  const [selectedCc1, setSelectedCc1] = useState("");
  const showCcFollowups = Boolean(selectedCc1 && selectedCc1 !== `4. ${cc1Choices[3]}`);
  const [interventions, setInterventions] = useState<string[]>([]);
  const [contactNumber, setContactNumber] = useState("");
  const [addressRegions, setAddressRegions] = useState<PSGCRegionOption[]>([]);
  const [addressIndexLoading, setAddressIndexLoading] = useState(true);
  const [addressRegion, setAddressRegion] = useState("");
  const [addressProvince, setAddressProvince] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressBarangay, setAddressBarangay] = useState("");
  const [addressRegionData, setAddressRegionData] = useState<PSGCRegionData | null>(null);
  const [addressRegionLoading, setAddressRegionLoading] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateLayout = () => setIsMobileLayout(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener("change", updateLayout);
    return () => mediaQuery.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/psgc/index.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("PSGC index unavailable");
        return response.json() as Promise<{ regions: PSGCRegionOption[] }>;
      })
      .then((data) => setAddressRegions(data.regions))
      .catch(() => {
        if (controller.signal.aborted) return;
        setAddressError("Dili ma-load ang listahan sa mga rehiyon. I-refresh ang panid ug sulayi pag-usab.");
      })
      .finally(() => { if (!controller.signal.aborted) setAddressIndexLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!addressRegion) {
      setAddressRegionData(null);
      setAddressRegionLoading(false);
      return;
    }
    const controller = new AbortController();
    setAddressError("");
    setAddressRegionData(null);
    setAddressRegionLoading(true);
    fetch(`/data/psgc/regions/${addressRegion}.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("PSGC region unavailable");
        return response.json() as Promise<PSGCRegionData>;
      })
      .then((data) => {
        setAddressRegionData(data);
        setAddressError("");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setAddressError("Dili ma-load ang listahan sa mga probinsya ug barangay. Sulayi pag-usab.");
      })
      .finally(() => { if (!controller.signal.aborted) setAddressRegionLoading(false); });
    return () => controller.abort();
  }, [addressRegion]);

  const currentAddressRegionData = addressRegionData?.code === addressRegion ? addressRegionData : null;
  const selectedAddressRegion = addressRegions.find((region) => region.code === addressRegion);
  const independentProvinceLabel = selectedAddressRegion?.code === "1600000000"
    ? "Butuan City"
    : "Independent city/municipality (walay probinsya)";
  const selectedAddressProvince = currentAddressRegionData?.provinces.find((province) => province.code === addressProvince);
  const addressProvinceOptions = currentAddressRegionData
    ? [...currentAddressRegionData.provinces, ...(currentAddressRegionData.independentCities.length ? [{ code: independentCitiesCode, name: independentProvinceLabel, cities: [] }] : [])]
    : [];
  const addressCityOptions = addressProvince === independentCitiesCode
    ? currentAddressRegionData?.independentCities ?? []
    : selectedAddressProvince?.cities ?? [];
  const selectedAddressCity = addressCityOptions.find((city) => city.code === addressCity);
  const selectedAddressBarangay = selectedAddressCity?.barangays.find(([code]) => code === addressBarangay);

  async function submitEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!interventions.length) {
      setNotice("Pilia ang labing menos usa ka serbisyo/interbensyon nga imong nadawat.");
      return;
    }
    if (beneficiaryCategory === "Uban pa" && !value(form, "beneficiaryOther")) {
      setNotice("Isulat ang ubang klase sa benepisyaryo.");
      return;
    }
    const receivedOther = interventions.includes("Uban pa");
    if (receivedOther && (!value(form, "interventionOtherQuantity") || !value(form, "interventionOtherDetail"))) {
      setNotice("Ihatag ang gidaghanon ug detalye sa ubang interbensyon.");
      return;
    }
    setSaving(true);
    setNotice("");
    const responseRef = doc(db, "programEvaluations", program.id, "responses", respondentUid);
    const clientType = value(form, "clientType");
    const cc1 = value(form, "cc1");
    const data: Omit<ProgramEvaluation, "id"> = {
      programId: program.id,
      programTitle: program.eventTitle,
      respondentUid,
      respondentKind,
      name: fullRespondentName(form, beneficiaryType),
      clientType,
      beneficiaryType,
      beneficiaryCategory,
      beneficiaryOther: value(form, "beneficiaryOther"),
      registrationId: value(form, "registrationId"),
      contactNo: `+63 9${value(form, "contactNo")}`,
      groupName: value(form, "groupName"),
      firstName: value(form, "firstName"),
      middleName: value(form, "middleName"),
      lastName: value(form, "lastName"),
      suffix: value(form, "suffix"),
      region: value(form, "region"),
      province: value(form, "province"),
      cityMunicipality: value(form, "cityMunicipality"),
      barangay: value(form, "barangay"),
      street: value(form, "street"),
      sex: value(form, "sex"),
      birthdate: value(form, "birthdate"),
      membership: value(form, "membership"),
      interventions,
      interventionOtherQuantity: value(form, "interventionOtherQuantity"),
      interventionOtherDetail: value(form, "interventionOtherDetail"),
      cc1,
      cc2: cc1.startsWith("4.") ? "" : value(form, "cc2"),
      cc3: cc1.startsWith("4.") ? "" : value(form, "cc3"),
      overallSatisfaction: value(form, "overallSatisfaction"),
      qualityScores: qualityQuestions.map((_, index) => value(form, `sqd${index + 1}`)),
      deliveryScore: value(form, "tdd1"),
      suggestions: value(form, "suggestions"),
      caDistributed: false,
      submittedAt: serverTimestamp(),
    };
    try {
      // The rules permit creates only and reject updates, so setDoc is an atomic,
      // single-write create that still prevents duplicate submissions per account.
      // A short randomized spread helps smooth a synchronized event-wide submit burst.
      await new Promise((resolve) => window.setTimeout(resolve, Math.random() * 3000));
      await setDoc(responseRef, data);
      onSubmitted();
    } catch (error) {
      // A competing tab or a retry after a lost network response may have already
      // created this respondent's document. Check only after a failed create.
      const existing = await getDoc(responseRef).catch(() => null);
      if (existing?.exists()) {
        setNotice("Naa na kay na-submit nga evaluation alang niining programa.");
        onSubmitted();
      } else {
        setNotice("Wala na-save ang evaluation. Susiha ang koneksyon ug sulayi pag-usab.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop evaluation-backdrop evaluation-form-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="form-modal evaluation-modal" role="dialog" aria-modal="true" aria-labelledby="evaluation-title">
      <div className="form-modal-head"><div><span className="eyebrow">CLIENT SATISFACTION MEASUREMENT</span><h2 id="evaluation-title">Client Satisfaction <i>Measurement</i><span>.</span></h2><p>{program.eventTitle}</p></div><button type="button" className="modal-close modal-close--inline" onClick={() => !saving && onClose()} aria-label="Close evaluation"><X size={19} /></button></div>
      <form className="evaluation-form" onSubmit={submitEvaluation}>
        <div className="evaluation-intro">Kini nga Client Satisfaction Measurement (CSM) magsusi sa kasinatian sa kustomer sa mga buhatan sa gobyerno. Ang imong feedback sa bag-o lang nahuman nga transaksyon makatabang niining maong opisina aron makatanyag og mas maayong serbisyo. Ang imong ipaambit nga personal nga mga impormasyon itratar nga konpidensyal ug aduna kay katungod sa dili pagtubag niining maong porma. Sa imong pagtubag niining maong porma, mitugot ka nga ang impormasyon gamiton sa Departamento sa paghulma og mga plano ug pagpaanindot sa programa o implementasyon sa proyekto.</div>

        <section className="evaluation-section"><h3>Impormasyon sa kliyente</h3>
          <div className="evaluation-desktop-only"><RadioChoices name="clientType" title="Klase sa Kliyente" choices={clientTypes} required disabled={isMobileLayout !== false} selectedValue={selectedClientType} onChange={setSelectedClientType} /></div>
          <div className="evaluation-desktop-only"><RadioChoices name="beneficiaryType" title="Klase sa Benepisyaryo" choices={["Indibidwal", "Grupo"]} required disabled={isMobileLayout !== false} selectedValue={beneficiaryType} onChange={(value) => { setBeneficiaryType(value); setBeneficiaryCategory(""); }} /></div>
          <div className="evaluation-mobile-only evaluation-grid evaluation-grid--mobile-intake">
            <EvaluationField label="Klase sa Kliyente"><select name="clientType" value={selectedClientType} required disabled={isMobileLayout !== true} onChange={(event) => setSelectedClientType(event.target.value)}><option value="" disabled>Pilia ang klase</option>{clientTypes.map((clientType) => <option key={clientType}>{clientType}</option>)}</select></EvaluationField>
            <EvaluationField label="Klase sa Benepisyaryo"><select name="beneficiaryType" value={beneficiaryType} required disabled={isMobileLayout !== true} onChange={(event) => { setBeneficiaryType(event.target.value); setBeneficiaryCategory(""); }}><option value="" disabled>Pilia ang klase</option>{["Indibidwal", "Grupo"].map((type) => <option key={type}>{type}</option>)}</select></EvaluationField>
          </div>
          {beneficiaryType === "Grupo" && <div className="evaluation-grid evaluation-grid--group">
            <EvaluationField label="Klase sa Grupo"><select name="beneficiaryCategory" value={beneficiaryCategory} required onChange={(event) => setBeneficiaryCategory(event.target.value)}><option value="" disabled>Pilia ang klase</option>{groupBeneficiaries.map((category) => <option key={category}>{category}</option>)}</select></EvaluationField>
            <EvaluationField label="Rehistradong Pangalan sa Grupo"><input name="groupName" autoComplete="organization" required /></EvaluationField>
          </div>}
          {beneficiaryType === "Indibidwal" && <div className="evaluation-grid evaluation-grid--individual">
            <EvaluationField label="Klase sa Indibidwal"><select name="beneficiaryCategory" value={beneficiaryCategory} required onChange={(event) => setBeneficiaryCategory(event.target.value)}><option value="" disabled>Pilia ang klase</option>{individualBeneficiaries.map((category) => <option key={category}>{category}</option>)}</select></EvaluationField>
            <EvaluationField label="Pangalan"><input name="firstName" autoComplete="given-name" required /></EvaluationField>
            <EvaluationField label="Middle Name"><input name="middleName" autoComplete="additional-name" /></EvaluationField>
            <EvaluationField label="Apilido"><input name="lastName" autoComplete="family-name" required /></EvaluationField>
            <EvaluationField label="Extensyon"><select name="suffix" defaultValue=""><option value="">Walay extensyon</option>{["Jr.", "Sr.", "I", "II", "III", "IV", "V", "VI"].map((suffix) => <option key={suffix}>{suffix}</option>)}</select></EvaluationField>
          </div>}
          {beneficiaryCategory === "Uban pa" && <EvaluationField label="Palihog ihulagway ang uban pa"><input name="beneficiaryOther" required /></EvaluationField>}
          {beneficiaryType && <div className="evaluation-grid evaluation-grid--two">
            <EvaluationField label="Numero sa ID sa Pagrehistro (RSBSA/FFEDIS)" optional><input name="registrationId" /></EvaluationField>
          <EvaluationField label="Numero nga makontak"><div className="evaluation-phone-input"><span aria-hidden="true">+63 9</span><input name="contactNo" type="tel" inputMode="numeric" aria-label="Nahibiling numero human sa +63 9" value={contactNumber} onChange={(event) => setContactNumber(formatContactNumber(event.target.value))} pattern="[0-9]{2} [0-9]{3} [0-9]{4}" title="Ibutang ang nahibiling numero sa pormat nga NN NNN NNNN" autoComplete="tel-national" required /></div></EvaluationField>
          </div>}
        </section>

        <section className="evaluation-section"><h3>Address ug personal nga detalye</h3>
          <div className="evaluation-grid evaluation-grid--address">
            <EvaluationField label="Rehiyon"><select autoComplete="address-level1" value={addressRegion} required disabled={addressIndexLoading} onChange={(event) => { setAddressRegion(event.target.value); setAddressProvince(""); setAddressCity(""); setAddressBarangay(""); }}><option value="" disabled>{addressIndexLoading ? "Nag-load sa mga rehiyon…" : "Pilia ang rehiyon"}</option>{addressRegions.map((region) => <option key={region.code} value={region.code}>{region.name}</option>)}</select></EvaluationField>
            <EvaluationField label="Probinsya"><select autoComplete="address-level1" value={addressProvince} required disabled={!currentAddressRegionData || addressRegionLoading} onChange={(event) => { setAddressProvince(event.target.value); setAddressCity(""); setAddressBarangay(""); }}><option value="" disabled>{addressRegionLoading ? "Nag-load…" : "Pilia ang probinsya"}</option>{addressProvinceOptions.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}</select></EvaluationField>
            <EvaluationField label="Syudad / Munisipalidad"><select autoComplete="address-level2" value={addressCity} required disabled={!addressProvince || addressRegionLoading} onChange={(event) => { setAddressCity(event.target.value); setAddressBarangay(""); }}><option value="" disabled>Pilia ang syudad/munisipalidad</option>{addressCityOptions.map((city) => <option key={city.code} value={city.code}>{city.name}</option>)}</select></EvaluationField>
            <EvaluationField label="Barangay"><select value={addressBarangay} required disabled={!addressCity || addressRegionLoading} onChange={(event) => setAddressBarangay(event.target.value)}><option value="" disabled>Pilia ang barangay</option>{selectedAddressCity?.barangays.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></EvaluationField>
            <EvaluationField label="Dalan / Purok"><input name="street" autoComplete="street-address" required /></EvaluationField>
          </div>
          <input type="hidden" name="region" value={selectedAddressRegion?.name ?? ""} />
          <input type="hidden" name="province" value={selectedAddressProvince?.name ?? (addressProvince === independentCitiesCode ? independentProvinceLabel : "")} />
          <input type="hidden" name="cityMunicipality" value={selectedAddressCity?.name ?? ""} />
          <input type="hidden" name="barangay" value={selectedAddressBarangay?.[1] ?? ""} />
          {addressError && <p className="evaluation-helper" role="alert">{addressError}</p>}
          <div className="evaluation-grid evaluation-grid--personal-row">
            <EvaluationField label="Sex"><select name="sex" defaultValue="" required><option value="" disabled>Pilia ang sex</option><option>Lalaki</option><option>Babae</option></select></EvaluationField>
            <EvaluationField label="Adlaw nga Natawhan"><input name="birthdate" type="date" max={new Date().toISOString().slice(0, 10)} required /></EvaluationField>
            <EvaluationField label="Myembro nianing Sumosunod"><select name="membership" defaultValue=""><option value="">Walay tubag</option>{["ARB", "IP's", "PWD", "4P's"].map((membership) => <option key={membership}>{membership}</option>)}</select></EvaluationField>
          </div>
        </section>

        <section className="evaluation-section"><h3>Interbensyon ug serbisyo</h3>
          <CheckboxChoices title="Interbensyon / Serbisyo nga Nadawat" choices={receivedServices} selected={interventions} onChange={setInterventions} />
          {interventions.includes("Uban pa") && <div className="evaluation-grid evaluation-grid--two">
            <EvaluationField label="Gidaghanon"><input name="interventionOtherQuantity" type="number" min="1" step="1" required /></EvaluationField>
            <EvaluationField label="Detalye sa Interbensyon"><input name="interventionOtherDetail" required /></EvaluationField>
          </div>}
        </section>

        <section className="evaluation-section"><h3>Citizen's Charter (CC)</h3>
          <div className={`evaluation-grid evaluation-grid--cc${showCcFollowups ? "" : " evaluation-grid--cc-alone"}`}>
            <EvaluationField label="CC1. Asa niini ang naghulagway sa imong pagkasayud sa CC?"><select name="cc1" value={selectedCc1} required onChange={(event) => setSelectedCc1(event.target.value)}><option value="" disabled>Pilia ang tubag</option>{cc1Choices.map((choice, index) => <option key={choice} value={(index + 1) + ". " + choice}>{index + 1}. {choice}</option>)}</select></EvaluationField>
            {showCcFollowups && <>
              <EvaluationField label="CC2. Kung nahibawo ka bahin sa CC, unsa kini kadaling makita?"><select name="cc2" defaultValue="" required><option value="" disabled>Pilia ang tubag</option>{cc2Choices.map((choice, index) => <option key={choice} value={(index + 1) + ". " + choice}>{index + 1}. {choice}</option>)}</select></EvaluationField>
              <EvaluationField label="CC3. Sa unsa ka dako ang gikatabang sa CC sa imong transaksyon?"><select name="cc3" defaultValue="" required><option value="" disabled>Pilia ang tubag</option>{cc3Choices.map((choice, index) => <option key={choice} value={(index + 1) + ". " + choice}>{index + 1}. {choice}</option>)}</select></EvaluationField>
            </>}
          </div>
          <p className="evaluation-helper">Tubaga ang CC2 ug CC3 kung mitubag ka og 1–3 sa CC1.</p>
        </section>

        <section className="evaluation-section evaluation-rating-section"><h3>Mga Sukdanan</h3>
          <div className="evaluation-rating-table-wrap">
            <table className="evaluation-rating-table">
              <colgroup><col /><col />{agreementChoices.map((choice) => <col key={choice} />)}</colgroup>
              <thead>
                <tr><th scope="col" rowSpan={2}>Indicators</th><th scope="col" rowSpan={2}>Mga Sukdanan</th><th scope="colgroup" colSpan={agreementChoices.length}>Grado</th></tr>
                <tr>{agreementChoices.map((choice) => <th scope="col" key={choice}>{choice}</th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Overall</th>
                  <td>Ako natagbaw sa serbisyo/interbensyon nga akong nadawat gikan sa DA.</td>
                  {agreementChoices.map((choice) => <RatingChoiceCell key={choice} name="overallSatisfaction" title="Overall satisfaction" choice={choice} required />)}
                </tr>
                {qualityQuestions.map((question, index) => <tr key={question}>
                  {index === 0 && <th scope="rowgroup" rowSpan={qualityQuestions.length}>Sukdanan Sa Kalidad Sa Serbisyo</th>}
                  <td>{`SQD${index + 1}. ${question}`}</td>
                  {agreementChoices.map((choice) => <RatingChoiceCell key={choice} name={`sqd${index + 1}`} title={`SQD${index + 1}`} choice={choice} required={index !== 4} />)}
                </tr>)}
                <tr>
                  <th scope="row">Sukdanan sa Panahon sa Pagtunol</th>
                  <td>TDD1. Akong nadawat ang serbisyo/interbensyon sibo gayud sa panahon sa katuyoan/gilauman nga higayon sa pagtunol.</td>
                  {agreementChoices.map((choice) => <RatingChoiceCell key={choice} name="tdd1" title="TDD1" choice={choice} required />)}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="evaluation-section"><h3>Mga suhestyon</h3>
          <EvaluationField label="Mga suhestyon unsaon nga amo pang mapanindot og dugang ang among serbisyo" optional><textarea name="suggestions" rows={4} /></EvaluationField>
        </section>

        {notice && <p className="evaluation-notice" role="alert">{notice}</p>}
        <div className="form-modal-actions evaluation-actions"><button type="button" className="button button--soft" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="button button--olive" disabled={saving}>{saving ? "Gina-save…" : "Submit evaluation"} {saving ? null : <ArrowRight size={15} />}</button></div>
      </form>
    </section>
  </div>;
}

function EvaluationField({ label, optional = false, hint, children }: { label: string; optional?: boolean; hint?: string; children: ReactNode }) {
  return <label className="evaluation-field"><span className="evaluation-field-label">{label}{optional && <small> (Optional)</small>}{hint && <small>{hint}</small>}</span>{children}</label>;
}

function RatingChoiceCell({ name, title, choice, required }: { name: string; title: string; choice: string; required: boolean }) {
  return <td className="evaluation-rating-cell"><label aria-label={`${title}: ${choice}`}><input type="radio" name={name} value={choice} required={required} /></label></td>;
}

function RadioChoices({ name, title, choices, required = false, disabled = false, selectedValue, onChange }: { name: string; title: string; choices: string[]; required?: boolean; disabled?: boolean; selectedValue?: string; onChange?: (value: string) => void }) {
  return <fieldset className={`evaluation-choice-set${name === "cc1" ? " evaluation-choice-set--long" : ""}`} disabled={disabled}><legend>{title}{required && <span aria-hidden="true"> *</span>}</legend><div className="evaluation-choices">{choices.map((choice) => <label className="evaluation-choice" key={choice}><input type="radio" name={name} value={choice} required={required} checked={selectedValue === undefined ? undefined : selectedValue === choice} onChange={() => onChange?.(choice)} /><span>{choice}</span></label>)}</div></fieldset>;
}

function CheckboxChoices({ title, choices, selected, onChange }: { title: string; choices: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="evaluation-choice-set"><legend>{title}<span aria-hidden="true"> *</span><small> (Pilia ang tanan nga angay)</small></legend><div className="evaluation-choices">{choices.map((choice) => <label className="evaluation-choice evaluation-choice--checkbox" key={choice}><input type="checkbox" value={choice} checked={selected.includes(choice)} onChange={(event) => onChange(event.target.checked ? [...selected, choice] : selected.filter((item) => item !== choice))} /><span>{choice}</span></label>)}</div></fieldset>;
}

function displayBirthdate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-PH", { month: "2-digit", day: "2-digit", year: "numeric" });
}

const csmTemplateWidth = 1241;
const csmTemplateHeight = 1754;
const csmRatingColumnCenters = [719, 823, 926, 1032, 1134];
const csmRatingRowCenters = [1178, 1216, 1255, 1299, 1347, 1398, 1444, 1484, 1525, 1566];

function csmPrintDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function csmPrintDateRange(program: Program) {
  const from = csmPrintDate(program.dateFrom);
  const to = csmPrintDate(program.dateTo);
  if (!from) return to;
  if (!to || program.dateFrom === program.dateTo) return from;
  return `${from} – ${to}`;
}

function csmSelectedIndex(value: unknown, choices: string[]) {
  const selected = String(value ?? "").trim().toLocaleLowerCase();
  if (!selected) return -1;
  const exactIndex = choices.findIndex((choice) => choice.toLocaleLowerCase() === selected);
  if (exactIndex >= 0) return exactIndex;
  const prefix = selected.match(/^(\d+)/)?.[1];
  if (prefix) {
    const index = Number(prefix) - 1;
    if (index >= 0 && index < choices.length) return index;
  }
  return choices.findIndex((choice) => selected.includes(choice.toLocaleLowerCase()));
}

function CsmPrintField({ x, y, width, height = 18, value, fontSize = 5.7, align = "left", multiline = false }: {
  x: number; y: number; width: number; height?: number; value: unknown; fontSize?: number; align?: "left" | "center" | "right"; multiline?: boolean;
}) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return <span className={`csm-print-field${multiline ? " csm-print-field--multiline" : ""}`} style={{ left: `${x / csmTemplateWidth * 100}%`, top: `${y / csmTemplateHeight * 100}%`, width: `${width / csmTemplateWidth * 100}%`, height: `${height / csmTemplateHeight * 100}%`, fontSize: `${fontSize}pt`, textAlign: align }}>{text}</span>;
}

function CsmPrintMark({ x, y, size = 18, fontSize = 9 }: { x: number; y: number; size?: number; fontSize?: number }) {
  return <span className="csm-print-mark" style={{ left: `${(x - size / 2) / csmTemplateWidth * 100}%`, top: `${(y - size / 2) / csmTemplateHeight * 100}%`, width: `${size / csmTemplateWidth * 100}%`, height: `${size / csmTemplateHeight * 100}%`, fontSize: `${fontSize}pt` }}>✓</span>;
}

function CsmPrintPage({ program, evaluation }: { program: Program; evaluation: ProgramEvaluation }) {
  const clientTypeIndex = clientTypes.findIndex((choice) => choice.toLocaleLowerCase() === String(evaluation.clientType ?? "").trim().toLocaleLowerCase());
  const isIndividual = evaluation.beneficiaryType === "Indibidwal";
  const isGroup = evaluation.beneficiaryType === "Grupo";
  const categories = isGroup ? groupBeneficiaries : individualBeneficiaries;
  const beneficiaryIndex = categories.indexOf(evaluation.beneficiaryCategory ?? "");
  const fallbackNameParts = String(evaluation.name ?? "").trim().split(/\s+/).filter(Boolean);
  const hasNameParts = Boolean(evaluation.firstName || evaluation.middleName || evaluation.lastName || evaluation.suffix);
  const printFirstName = evaluation.firstName || (!isGroup && !hasNameParts ? fallbackNameParts[0] ?? "" : "");
  const printMiddleName = evaluation.middleName || (!isGroup && !hasNameParts && fallbackNameParts.length > 2 ? fallbackNameParts.slice(1, -1).join(" ") : "");
  const printLastName = evaluation.lastName || (!isGroup && !hasNameParts && fallbackNameParts.length > 1 ? fallbackNameParts[fallbackNameParts.length - 1] : "");
  const printGroupName = evaluation.groupName || (isGroup ? evaluation.name : "");
  const interventions = Array.isArray(evaluation.interventions) ? evaluation.interventions : [];
  const birthdateParts = String(evaluation.birthdate ?? "").split("-");
  const ratingValues = [evaluation.overallSatisfaction, ...Array.from({ length: 8 }, (_, index) => evaluation.qualityScores?.[index] ?? ""), evaluation.deliveryScore];
  const checks: Array<{ active: boolean; x: number; y: number }> = [];
  if (clientTypeIndex >= 0) checks.push({ active: true, x: [215, 374, 475][clientTypeIndex], y: 302 });
  if (isIndividual) checks.push({ active: true, x: 105, y: 344 });
  if (isGroup) checks.push({ active: true, x: 105, y: 372 });
  if (beneficiaryIndex >= 0) {
    const positions = isGroup
      ? [{ x: 514, y: 372 }, { x: 653, y: 372 }, { x: 761, y: 372 }, { x: 860, y: 372 }, { x: 965, y: 372 }]
      : [{ x: 514, y: 344 }, { x: 653, y: 344 }, { x: 761, y: 344 }, { x: 860, y: 344 }];
    if (positions[beneficiaryIndex]) checks.push({ active: true, ...positions[beneficiaryIndex] });
  }
  if (evaluation.sex === "Lalaki") checks.push({ active: true, x: 371, y: 594 });
  if (evaluation.sex === "Babae") checks.push({ active: true, x: 513, y: 594 });
  const memberships = ["ARB", "IP's", "PWD", "4P's"];
  const membershipIndex = memberships.findIndex((membership) => membership.toLocaleLowerCase() === String(evaluation.membership ?? "").trim().toLocaleLowerCase());
  if (membershipIndex >= 0) checks.push({ active: true, x: [375, 515, 653, 761][membershipIndex], y: 637 });
  const interventionXs = [117, 350, 449, 674, 853, 1070];
  receivedServices.forEach((service, index) => {
    if (interventions.includes(service)) checks.push({ active: true, x: interventionXs[index], y: 709 });
  });
  const cc1Index = csmSelectedIndex(evaluation.cc1, cc1Choices);
  const cc1Positions = [{ x: 117, y: 844 }, { x: 117, y: 870 }, { x: 674, y: 844 }, { x: 674, y: 870 }];
  if (cc1Positions[cc1Index]) checks.push({ active: true, ...cc1Positions[cc1Index] });
  const cc2Index = csmSelectedIndex(evaluation.cc2, cc2Choices);
  const cc2Xs = [117, 350, 653, 855, 1072];
  if (cc2Xs[cc2Index] !== undefined) checks.push({ active: true, x: cc2Xs[cc2Index], y: 918 });
  const cc3Index = csmSelectedIndex(evaluation.cc3, cc3Choices);
  const cc3Xs = [117, 350, 653, 855];
  if (cc3Xs[cc3Index] !== undefined) checks.push({ active: true, x: cc3Xs[cc3Index], y: 965 });

  return <article className="csm-print-page">
    <img className="csm-print-template" src="/csm_template.jpg" alt="" />
    <div className="csm-print-overlay">
      <CsmPrintField x={365} y={29} width={830} height={16} fontSize={4.6} align="right" value={`PROGRAM: ${program.eventTitle}  |  DATE: ${csmPrintDateRange(program)}  |  VENUE: ${program.venue}`} />
      <CsmPrintField x={332} y={420} width={414} value={evaluation.registrationId} />
      <CsmPrintField x={923} y={420} width={258} value={evaluation.contactNo} />
      <CsmPrintField x={332} y={458} width={846} value={printGroupName} />
      <CsmPrintField x={362} y={493} width={164} value={printFirstName} />
      <CsmPrintField x={540} y={493} width={172} value={printMiddleName} />
      <CsmPrintField x={728} y={493} width={250} value={printLastName} />
      <CsmPrintField x={1004} y={493} width={174} value={evaluation.suffix} />
      <CsmPrintField x={361} y={541} width={158} value={evaluation.region} />
      <CsmPrintField x={526} y={541} width={156} value={evaluation.province} />
      <CsmPrintField x={692} y={541} width={169} value={evaluation.cityMunicipality} />
      <CsmPrintField x={870} y={541} width={150} value={evaluation.barangay} />
      <CsmPrintField x={1027} y={541} width={151} value={evaluation.street} />
      <CsmPrintField x={899} y={582} width={52} value={birthdateParts[1]} align="center" />
      <CsmPrintField x={953} y={582} width={51} value={birthdateParts[2]} align="center" />
      <CsmPrintField x={1007} y={582} width={78} value={birthdateParts[0]} align="center" />
      {evaluation.beneficiaryCategory === "Uban pa" && <CsmPrintField x={1063} y={isGroup ? 359 : 331} width={115} height={16} fontSize={5} value={evaluation.beneficiaryOther} />}
      {interventions.includes("Uban pa") && <>
        <CsmPrintField x={1072} y={730} width={105} height={17} value={evaluation.interventionOtherQuantity} />
        <CsmPrintField x={510} y={730} width={669} height={17} value={evaluation.interventionOtherDetail} />
      </>}
      {csmRatingRowCenters.map((rowY, rowIndex) => {
        const columnIndex = csmSelectedIndex(ratingValues[rowIndex], agreementChoices);
        return columnIndex < 0 ? null : <CsmPrintMark key={`rating-${rowIndex}`} x={csmRatingColumnCenters[columnIndex]} y={rowY} size={22} fontSize={10} />;
      })}
      <CsmPrintField x={58} y={1594} width={1124} height={124} fontSize={6.2} multiline value={evaluation.suggestions} />
      {checks.filter((check) => check.active).map((check, index) => <CsmPrintMark key={`check-${index}`} x={check.x} y={check.y} />)}
    </div>
  </article>;
}

export function CsmEvaluationPrintButton({ program }: { program: Program }) {
  const [printing, setPrinting] = useState(false);
  const [printEvaluations, setPrintEvaluations] = useState<ProgramEvaluation[] | null>(null);
  const [notice, setNotice] = useState("");

  async function preparePrint() {
    if (printing || printEvaluations) return;
    setPrinting(true);
    setNotice("");
    try {
      const snapshot = await getDocs(collection(db, "programEvaluations", program.id, "responses"));
      const submitted = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as ProgramEvaluation))
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")) || a.id.localeCompare(b.id));
      if (!submitted.length) {
        setNotice("No submitted forms");
        return;
      }
      setPrintEvaluations(submitted);
    } catch {
      setNotice("Could not load forms");
    } finally {
      setPrinting(false);
    }
  }

  useEffect(() => {
    if (!printEvaluations) return;
    let cancelled = false;
    const pageStyle = document.createElement("style");
    pageStyle.media = "print";
    pageStyle.textContent = "@page { size: A4 portrait; margin: 0; }";
    document.head.appendChild(pageStyle);
    const afterPrint = () => setPrintEvaluations(null);
    window.addEventListener("afterprint", afterPrint, { once: true });
    const templates = Array.from(document.querySelectorAll<HTMLImageElement>(".csm-print-template"));
    void Promise.all(templates.map((image) => image.decode().catch(() => undefined))).then(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    })).then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
      pageStyle.remove();
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [printEvaluations]);

  return <>
    <button type="button" className="button button--soft csm-print-button" disabled={printing || Boolean(printEvaluations)} title={notice || "Print submitted CSM forms on A4 paper"} onClick={() => void preparePrint()}><Printer size={15} />{printing ? "Preparing…" : "Print"}</button>
    {notice && <span className="csm-print-status" role="status">{notice}</span>}
    {printEvaluations && typeof document !== "undefined" && createPortal(<div className="csm-print" aria-hidden="true">{printEvaluations.map((evaluation) => <CsmPrintPage key={evaluation.id} program={program} evaluation={evaluation} />)}</div>, document.body)}
  </>;
}

export function ProgramEvaluationMasterlistModal({ program, onClose }: {
  program: Program;
  onClose: () => void;
}) {
  const [evaluations, setEvaluations] = useState<ProgramEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => onSnapshot(collection(db, "programEvaluations", program.id, "responses"), (snapshot) => {
    setEvaluations(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as ProgramEvaluation)));
    setLoading(false);
    setError("");
  }, () => { setError("Dili maablihan ang masterlist. Siguroha nga admin ang account ug sulayi pag-usab."); setLoading(false); }), [program.id]);

  const visibleEvaluations = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return evaluations.filter((entry) => !needle || `${entry.name} ${entry.birthdate} ${displayBirthdate(entry.birthdate)} ${entry.contactNo}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [evaluations, search]);
  const distributedCount = evaluations.filter((evaluation) => evaluation.caDistributed === true).length;

  async function setDistributed(evaluation: ProgramEvaluation, caDistributed: boolean) {
    setUpdatingId(evaluation.id);
    setError("");
    try {
      await updateDoc(doc(db, "programEvaluations", program.id, "responses", evaluation.id), { caDistributed });
    } catch {
      setError("Wala na-update ang CA Distributed. Sulayi pag-usab.");
    } finally {
      setUpdatingId("");
    }
  }

  return <div className="modal-backdrop evaluation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !updatingId) onClose(); }}>
    <section className="form-modal evaluation-masterlist-modal" role="dialog" aria-modal="true" aria-labelledby="evaluation-masterlist-title">
      <div className="form-modal-head"><div className="evaluation-masterlist-heading"><span className="eyebrow">CLIENT SATISFACTION MEASUREMENT</span><h2 id="evaluation-masterlist-title">Evaluation <i>masterlist</i><span>.</span></h2><div className="evaluation-masterlist-program-row"><p>{program.eventTitle}</p></div></div><button type="button" className="modal-close modal-close--inline" onClick={() => !updatingId && onClose()} aria-label="Close evaluation masterlist"><X size={19} /></button></div>
      <div className="evaluation-masterlist-toolbar"><label className="evaluation-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pangalan, adlaw nga natawhan, o numero nga makontak" aria-label="Search evaluations by name, birthdate, or contact number" /></label><span className="evaluation-masterlist-counts">{visibleEvaluations.length} {visibleEvaluations.length === 1 ? "evaluation" : "evaluations"}{" | No. of CA Distributed: "}{distributedCount} out of {evaluations.length}</span></div>
      {error && <p className="evaluation-notice" role="alert">{error}</p>}
      <div className="evaluation-masterlist-table-wrap"><table className="approval-table evaluation-masterlist-table"><thead><tr><th>PANGALAN</th><th>ADLAW NGA NATAWHAN</th><th>NUMERO NGA MAKONTAK</th><th>CA DISTRIBUTED</th></tr></thead><tbody>
        {visibleEvaluations.map((evaluation) => <tr key={evaluation.id}><td><strong className="table-primary">{evaluation.name || "—"}</strong></td><td>{displayBirthdate(evaluation.birthdate)}</td><td>{evaluation.contactNo || "—"}</td><td><label className="ca-distributed-control"><input type="checkbox" aria-label={`CA Distributed for ${evaluation.name}`} checked={evaluation.caDistributed === true} disabled={updatingId === evaluation.id} onChange={(event) => void setDistributed(evaluation, event.target.checked)} /><span>{evaluation.caDistributed ? <Check size={13} /> : null}</span></label></td></tr>)}
        {!visibleEvaluations.length && <tr><td colSpan={4} className="empty-table"><Search size={19} /><strong>{loading ? "Nag-load sa mga evaluation…" : search ? "Walay nagpares nga evaluation" : "Wala pay evaluation"}</strong><span>{loading ? "Ang mga tubag makita dinhi human ma-submit." : search ? "Sulayi ang laing search term." : "Makita dinhi ang mga tubag alang niining programa."}</span></td></tr>}
      </tbody></table></div>
      <div className="form-modal-actions"><button type="button" className="button button--soft" disabled={Boolean(updatingId)} onClick={onClose}>Close</button></div>
    </section>
  </div>;
}
