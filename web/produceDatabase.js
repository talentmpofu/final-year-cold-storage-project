// Produce Storage Conditions Database
// Optimal temperature, humidity, and VOC thresholds for different produce types

const produceDatabase = {
  apples: {
    name: "Apples",
    temperature: {
      min: 0,
      max: 4,
      optimal: 2,
    },
    humidity: {
      min: 90,
      max: 95,
      optimal: 92,
    },
    vocs: {
      threshold: 30000, // Apples produce moderate ethylene
      sensitivity: "medium",
    },
    description: "Apples produce ethylene and require cold storage",
    storageLife: "3-8 months at optimal conditions",
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
      threshold: 30000, // Moderately sensitive to ethylene
      sensitivity: "medium",
    },
    description: "Potatoes require cool, dark storage with good ventilation",
    storageLife: "5-8 months at optimal conditions",
    icon: "",
  },

  mixed: {
    name: "Mixed Produce",
    temperature: {
      min: 2,
      max: 8,
      optimal: 5,
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
    description: "Balanced settings for multiple produce types",
    storageLife: "Varies by item",
    icon: "",
  },
};

module.exports = produceDatabase;
