import { scope } from "hardhat/config";

export const sedaScope = scope(
  "seda",
  "Deploy and interact with SEDA contracts",
);

import "./deploy";
import "./mock-prices";
import "./pause";
import "./prices";
import "./status";
