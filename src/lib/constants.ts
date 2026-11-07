export const PURPOSE_ICON: Record<string, string> = {
  medical: "medkit-outline", elder_care: "heart-outline", education: "school-outline", household: "home-outline",
  trip: "airplane-outline", event: "sparkles-outline", project: "hammer-outline", community: "people-outline",
  fundraiser: "gift-outline", memorial: "flower-outline", pets: "paw-outline", other: "albums-outline",
};

export const CATEGORY_ICON: Record<string, string> = {
  hospital: "business-outline", doctor: "medkit-outline", medicine: "bandage-outline", tests: "flask-outline",
  nursing: "hand-left-outline", therapy: "fitness-outline", equipment: "construct-outline", travel: "car-outline",
  food: "restaurant-outline", rent: "home-outline", utilities: "flash-outline", insurance: "shield-checkmark-outline",
  fees: "school-outline", event: "sparkles-outline", lodging: "bed-outline", supplies: "cart-outline",
  services: "briefcase-outline", donation: "gift-outline", repairs: "hammer-outline", pets: "paw-outline",
  other: "pricetag-outline",
};

const ALL = Object.keys(CATEGORY_ICON);
export const CATEGORIES_BY_PURPOSE: Record<string, string[]> = {
  medical: ["hospital", "doctor", "medicine", "tests", "nursing", "therapy", "equipment", "travel", "food", "lodging", "insurance", "other"],
  elder_care: ["nursing", "medicine", "doctor", "rent", "food", "utilities", "equipment", "repairs", "travel", "insurance", "services", "other"],
  education: ["fees", "rent", "lodging", "food", "travel", "supplies", "equipment", "insurance", "other"],
  household: ["rent", "utilities", "food", "supplies", "repairs", "services", "insurance", "equipment", "travel", "other"],
  trip: ["travel", "lodging", "food", "event", "fees", "supplies", "insurance", "other"],
  event: ["event", "food", "lodging", "travel", "services", "supplies", "rent", "fees", "other"],
  project: ["supplies", "services", "repairs", "equipment", "fees", "travel", "food", "other"],
  community: ["rent", "utilities", "supplies", "services", "repairs", "event", "food", "fees", "donation", "other"],
  fundraiser: ["donation", "hospital", "medicine", "fees", "supplies", "services", "travel", "other"],
  memorial: ["services", "event", "food", "travel", "lodging", "donation", "fees", "other"],
  pets: ["pets", "doctor", "medicine", "food", "supplies", "services", "insurance", "other"],
  other: ALL,
};
