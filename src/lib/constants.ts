export const PURPOSE_ICON: Record<string, string> = {
  medical: "medkit-outline", elder_care: "heart-outline", education: "school-outline",
  event: "sparkles-outline", household: "home-outline", other: "albums-outline",
};

export const CATEGORY_ICON: Record<string, string> = {
  hospital: "business-outline", doctor: "medkit-outline", medicine: "bandage-outline", tests: "flask-outline",
  nursing: "hand-left-outline", therapy: "fitness-outline", equipment: "construct-outline", travel: "car-outline",
  food: "restaurant-outline", rent: "home-outline", utilities: "flash-outline", insurance: "shield-checkmark-outline",
  fees: "school-outline", event: "sparkles-outline", other: "pricetag-outline",
};

export const CATEGORIES_BY_PURPOSE: Record<string, string[]> = {
  medical: ["hospital", "doctor", "medicine", "tests", "nursing", "therapy", "equipment", "travel", "food", "insurance", "other"],
  elder_care: ["nursing", "medicine", "doctor", "rent", "food", "utilities", "equipment", "travel", "insurance", "other"],
  education: ["fees", "rent", "food", "travel", "equipment", "insurance", "other"],
  event: ["event", "food", "travel", "rent", "fees", "other"],
  household: ["rent", "utilities", "food", "insurance", "equipment", "travel", "other"],
  other: ["hospital", "doctor", "medicine", "tests", "nursing", "therapy", "equipment", "travel", "food", "rent", "utilities", "insurance", "fees", "event", "other"],
};
