interface ConnectionCommon {
  weight: number;
  type?: "positive" | "negative" | "condition";
}

export interface ConnectionInternal extends ConnectionCommon {
  from: number;
  to: number;
}

export interface ConnectionExport extends ConnectionCommon {
  fromUUID: string;
  toUUID: string;
}

export interface ConnectionTrace extends ConnectionExport {
  trace: {
    eligibility?: number;

    used?: boolean;
    totalValue?: number;
    totalActivation?: number;
  };
}
