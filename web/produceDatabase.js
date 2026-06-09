// Produce Storage Conditions Database
// Optimal temperature, humidity, and VOC thresholds for different produce types

const produceDatabase = {
  tomatoes: {
    name: "Tomatoes",
    temperature: {
      min: 10,
      max: 13,
      optimal: 11.5,
    },
    humidity: {
      min: 90,
      max: 95,
      optimal: 92,
    },
    vocs: {
      threshold: 50000,
      sensitivity: "medium",
    },
    description: "Tomatoes require warmer cold storage than potatoes",
    storageLife: "1-3 weeks at optimal conditions",
    icon: "",
  },

  potatoes: {
    name: "Potatoes",
    temperature: {
      min: 7,
      max: 10,
      optimal: 8,
    },
    humidity: {
      min: 85,
      max: 90,
      optimal: 87,
    },
    vocs: {
      threshold: 50000, // Moderately sensitive to ethylene
      sensitivity: "medium",
    },
    description: "Potatoes require cool, dark storage with good ventilation",
    storageLife: "5-8 months at optimal conditions",
    icon: "",
  },

  mixed: {
    name: "Mixed Tomatoes + Potatoes",
    temperature: {
      min: 9,
      max: 11,
      optimal: 10,
    },
    humidity: {
      min: 85,
      max: 95,
      optimal: 90,
    },
    vocs: {
      threshold: 28000,
      sensitivity: "medium",
    },
    description:
      "Balanced settings when tomatoes and potatoes are stored together",
    storageLife: "Varies by item",
    icon: "",
  },
};

function getProduceSettings(produceType) {
  const key = normalizeProduceType(produceType);
  const item = produceDatabase[key];
  if (!item) return null;

  return {
    temp: {
      min: Number(item.temperature?.min ?? 0),
      max: Number(item.temperature?.max ?? 0),
    },
    humidity: {
      min: Number(item.humidity?.min ?? 0),
      max: Number(item.humidity?.max ?? 0),
    },
    voc: Number(item.vocs?.threshold ?? 50000),
  };
}

function normalizeProduceType(produceType) {
  const key = String(produceType || "")
    .toLowerCase()
    .trim();
  if (key === "tomato" || key === "tomatoes") return "tomatoes";
  if (key === "potato" || key === "potatoes") return "potatoes";
  if (key === "mixed" || key === "custom") return "mixed";
  return key;
}

function getAllProduceSettings() {
  return produceDatabase;
}

// Keep backward compatibility for both styles:
// 1) const db = require('./produceDatabase'); db.tomatoes
// 2) const { getProduceSettings } = require('./produceDatabase')
produceDatabase.getProduceSettings = getProduceSettings;
produceDatabase.getAllProduceSettings = getAllProduceSettings;
produceDatabase.normalizeProduceType = normalizeProduceType;

module.exports = produceDatabase;
