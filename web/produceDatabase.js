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
    icon: "🍎",
  },

  tomatoes: {
    name: "Tomatoes",
    temperature: {
      min: 10,
      max: 15,
      optimal: 13,
    },
    humidity: {
      min: 85,
      max: 90,
      optimal: 87,
    },
    vocs: {
      threshold: 25000, // Very sensitive to ethylene
      sensitivity: "high",
    },
    description: "Tomatoes are highly sensitive to ethylene and cold damage",
    storageLife: "1-3 weeks at optimal conditions",
    icon: "🍅",
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
    icon: "🥔",
  },

  mixed: {
    name: "Mixed Produce",
    temperature: {
      min: 2,
      max: 4,
      optimal: 3,
    },
    humidity: {
      min: 85,
      max: 95,
      optimal: 90,
    },
    vocs: {
      threshold: 30000, // Conservative threshold
      sensitivity: "medium",
    },
    description: "Compromise settings for multiple produce types",
    storageLife: "Varies by produce type",
    icon: "🍎🍅🥔",
  },
};

// Function to get produce settings in ESP32-compatible format
function getProduceSettings(produceType) {
  const produce = produceDatabase[produceType];
  if (!produce) return null;

  return {
    temp: {
      min: produce.temperature.min,
      max: produce.temperature.max,
    },
    humidity: {
      min: produce.humidity.min,
      max: produce.humidity.max,
    },
    voc: produce.vocs.threshold,
  };
}

module.exports = { produceDatabase, getProduceSettings };
