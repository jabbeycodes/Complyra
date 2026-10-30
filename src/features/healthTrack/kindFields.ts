import {
  BM_CONSISTENCIES,
  CONTINENCE_STATES,
  ELIMINATION_AMOUNTS,
  GLUCOSE_CONTEXTS,
  MEAL_PORTIONS,
  MEAL_TYPES,
  MENSES_FLOWS,
  SKIN_BODY_LOCATIONS,
  SKIN_CHANGES,
  SKIN_OBSERVATIONS,
  SLEEP_QUALITIES,
  type HealthTrackKind,
} from "../../data/healthTrack";

/**
 * The per-kind detail fields for a health tracker entry — ONE definition
 * shared by the chart's Trackers-and-logs section and the mobile Health
 * quick-log sheets, so the two surfaces can never drift apart on fields,
 * labels, options, or conditional visibility. Validation lives in
 * data/healthTrack (validateHealthTrackDraft) and is likewise shared.
 */

export interface KindField {
  key: string;
  label: string;
  type?: "date" | "time" | "select" | "checkbox-text";
  options?: readonly string[];
  /** Render only when the current detail values call for it. */
  when?: (details: Record<string, string>) => boolean;
}

export const HEALTH_KIND_FIELDS: Record<HealthTrackKind, KindField[]> = {
  immunization: [
    { key: "vaccineName", label: "Vaccine" },
    { key: "doseLabel", label: "Dose (e.g. Annual, Booster)" },
    { key: "nextDueOn", label: "Next due", type: "date" },
  ],
  lab: [
    { key: "testName", label: "Test" },
    { key: "resultValue", label: "Result" },
    { key: "unit", label: "Unit" },
    { key: "referenceRange", label: "Reference range" },
  ],
  infection: [
    { key: "infectionType", label: "Infection" },
    { key: "bodySite", label: "Where on the body" },
    { key: "symptoms", label: "Symptoms" },
    { key: "treatment", label: "Treatment" },
    { key: "resolvedOn", label: "Resolved on", type: "date" },
    {
      key: "confirmedPositive",
      label: "Confirmed positive",
      type: "select",
      options: ["no", "yes"],
    },
  ],
  sleep: [
    { key: "hoursSlept", label: "Hours slept" },
    { key: "quality", label: "Quality", type: "select", options: SLEEP_QUALITIES },
    { key: "interruptions", label: "Interruptions" },
  ],
  intake: [
    {
      key: "entryType",
      label: "Meal or fluid",
      type: "select",
      options: ["meal", "fluid"],
    },
    {
      key: "mealType",
      label: "Meal",
      type: "select",
      options: MEAL_TYPES,
      when: (d) => d.entryType !== "fluid",
    },
    {
      key: "portion",
      label: "Portion eaten",
      type: "select",
      options: MEAL_PORTIONS,
      when: (d) => d.entryType !== "fluid",
    },
    {
      key: "appetiteNote",
      label: "Appetite note",
      when: (d) => d.entryType !== "fluid",
    },
    {
      key: "fluidType",
      label: "Fluid",
      when: (d) => d.entryType === "fluid",
    },
    {
      key: "fluidOz",
      label: "Ounces",
      when: (d) => d.entryType === "fluid",
    },
  ],
  elimination: [
    {
      key: "entryType",
      label: "Type",
      type: "select",
      options: ["bowel", "urination", "emesis"],
    },
    { key: "timeOfDay", label: "Time", type: "time" },
    {
      key: "amount",
      label: "Amount",
      type: "select",
      options: ELIMINATION_AMOUNTS,
    },
    {
      key: "consistency",
      label: "Consistency",
      type: "select",
      options: BM_CONSISTENCIES,
      when: (d) => d.entryType !== "urination" && d.entryType !== "emesis",
    },
    {
      key: "color",
      label: "Color",
      when: (d) => d.entryType !== "urination" && d.entryType !== "emesis",
    },
    {
      key: "bloodPresent",
      label: "Blood present",
      type: "select",
      options: ["no", "yes"],
      when: (d) => d.entryType !== "urination" && d.entryType !== "emesis",
    },
    {
      key: "painNoted",
      label: "Pain noted",
      type: "select",
      options: ["no", "yes"],
      when: (d) => d.entryType !== "urination" && d.entryType !== "emesis",
    },
    {
      key: "continence",
      label: "Continence",
      type: "select",
      options: CONTINENCE_STATES,
      when: (d) => d.entryType === "urination",
    },
  ],
  vitals: [
    { key: "temperatureF", label: "Temperature (°F)" },
    { key: "systolic", label: "Systolic" },
    { key: "diastolic", label: "Diastolic" },
    { key: "pulse", label: "Pulse" },
    { key: "respirations", label: "Respirations" },
    { key: "oxygenSaturation", label: "Oxygen saturation (%)" },
    { key: "weightLb", label: "Weight (lb)" },
    { key: "heightIn", label: "Height (in)" },
  ],
  seizure: [
    { key: "timeOfDay", label: "Time", type: "time" },
    { key: "seizureType", label: "Type / description" },
    { key: "durationMinutes", label: "Duration (minutes)" },
    { key: "triggers", label: "Possible triggers" },
    { key: "postEventState", label: "After the event" },
  ],
  menses: [
    { key: "endOn", label: "Ended on", type: "date" },
    { key: "flow", label: "Flow", type: "select", options: MENSES_FLOWS },
    { key: "symptoms", label: "Symptoms" },
  ],
  skin: [
    {
      key: "bodyLocation",
      label: "Where on the body",
      type: "select",
      options: SKIN_BODY_LOCATIONS,
    },
    {
      key: "observation",
      label: "Observation",
      type: "select",
      options: SKIN_OBSERVATIONS,
    },
    {
      key: "changeSinceLast",
      label: "Change since last check",
      type: "select",
      options: SKIN_CHANGES,
    },
    { key: "sizeDescription", label: "Size" },
    { key: "description", label: "Description" },
    { key: "followUpOn", label: "Follow-up date", type: "date" },
  ],
  glucose: [
    { key: "timeOfDay", label: "Time", type: "time" },
    { key: "readingMgDl", label: "Reading (mg/dL)" },
    {
      key: "context",
      label: "Context",
      type: "select",
      options: GLUCOSE_CONTEXTS,
    },
    { key: "symptoms", label: "Symptoms" },
  ],
  respiratory: [
    { key: "timeOfDay", label: "Time", type: "time" },
    { key: "treatmentType", label: "Treatment" },
    { key: "response", label: "Response" },
  ],
};

/** The date field's label per kind ("Date given", "Night of", …). */
export const HEALTH_DATE_LABELS: Record<HealthTrackKind, string> = {
  immunization: "Date given",
  lab: "Date collected",
  infection: "Started on",
  sleep: "Night of",
  intake: "Date",
  elimination: "Date",
  vitals: "Date taken",
  seizure: "Date",
  menses: "Started on",
  skin: "Date checked",
  glucose: "Date",
  respiratory: "Date",
};
