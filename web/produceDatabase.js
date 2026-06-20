// Produce Storage Conditions Database
// Optimal temperature, humidity, and VOC thresholds for different produce types

const produceDatabase = {
  mixed: {
    name: "Mixed Storage",
    temperature: {
      min: 10,
      max: 13,
      optimal: 11.5,
    },
    humidity: {
      min: 80,
      max: 90,
      optimal: 85,
    },
    vocs: {
      threshold: 50,
      sensitivity: "medium",
    },
    description:
      "Mixed tomato storage settings for two or more ripeness stages stored together.",
    storageLife: "1-2 weeks depending on the ripeness mix",
    icon: "",
  },
  tomatoes: {
    name: "Tomatoes",
    temperature: {
      min: 10,
      max: 13,
      optimal: 11.5,
    },
    humidity: {
      min: 80,
      max: 90,
      optimal: 85,
    },
    vocs: {
      threshold: 50,
      sensitivity: "medium",
    },
    description:
      "Generic tomato storage settings when ripeness stage is unknown.",
    storageLife: "1-3 weeks at optimal conditions",
    icon: "",
  },

  mature_green: {
    name: "Mature Green Tomatoes",
    temperature: {
      min: 13,
      max: 15,
      optimal: 14,
    },
    humidity: {
      min: 80,
      max: 90,
      optimal: 85,
    },
    vocs: {
      threshold: 50,
      sensitivity: "medium",
    },
    description:
      "Mature green tomatoes are best stored slightly warmer than ripe fruit.",
    storageLife: "2-3 weeks when stored at the correct temperature.",
    icon: "",
  },

  half_ripe: {
    name: "Half Ripe Tomatoes",
    temperature: {
      min: 10,
      max: 13,
      optimal: 11.5,
    },
    humidity: {
      min: 80,
      max: 90,
      optimal: 85,
    },
    vocs: {
      threshold: 50,
      sensitivity: "medium",
    },
    description:
      "Half ripe tomatoes should be held in cooler conditions to slow ripening.",
    storageLife: "1-2 weeks when held at stable, high humidity.",
    icon: "",
  },

  fully_ripe: {
    name: "Fully Ripe Tomatoes",
    temperature: {
      min: 9,
      max: 10,
      optimal: 9.5,
    },
    humidity: {
      min: 80,
      max: 90,
      optimal: 85,
    },
    vocs: {
      threshold: 50,
      sensitivity: "medium",
    },
    description:
      "Fully ripe tomatoes need cooler storage to preserve shelf life.",
    storageLife:
      "Up to 1 week when temperatures are kept low and humidity steady.",
    icon: "",
  },

  rotten: {
    name: "Rotten Tomatoes",
    temperature: {
      min: 0,
      max: 5,
      optimal: 2,
    },
    humidity: {
      min: 50,
      max: 60,
      optimal: 55,
    },
    vocs: {
      threshold: 200,
      sensitivity: "high",
    },
    description:
      "Rotten tomatoes should be removed from storage immediately. These thresholds are NOT suitable for long-term storage.",
    storageLife: "Not suitable for storage - remove immediately.",
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
    voc: Number(item.vocs?.threshold ?? 50),
  };
}

function normalizeProduceType(produceType) {
  const key = String(produceType || "")
    .toLowerCase()
    .trim();

  if (
    key.includes("mature") &&
    key.includes("green") &&
    key.includes("tomato")
  ) {
    return "mature_green";
  }
  if (key.includes("half") && key.includes("ripe") && key.includes("tomato")) {
    return "half_ripe";
  }
  if (
    (key.includes("fully") || key.includes("full")) &&
    key.includes("ripe") &&
    key.includes("tomato")
  ) {
    return "fully_ripe";
  }
  if (
    (key.includes("rotten") || key.includes("rot")) &&
    key.includes("tomato")
  ) {
    return "rotten";
  }
  if (key.includes("mixed")) {
    return "mixed";
  }
  if (key.includes("tomato") || key.includes("tomatoes")) return "tomatoes";
  if (key.includes("automatic") || key.includes("auto")) return "automatic";

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
