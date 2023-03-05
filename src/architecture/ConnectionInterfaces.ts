interface ConnectionCommon {
  weight: number;
  type?: "positive" | "negative" | "condition";
}

export interface ConnectionInternal extends ConnectionCommon {
  from: number;
  to: number;
  gater?: number;
}

export interface ConnectionExport extends ConnectionCommon {
  fromUUID: string;
  toUUID: string;
  gaterUUID?: string;
}

export interface ConnectionTrace extends ConnectionExport {
  trace: {
    used: boolean;
    // eligibility: number
  };
}
