import { IS_BRANDED } from '../../constants/brand';

/**
 * Whether the "Signing certificate provided by" logo block belongs in a signed
 * PDF footer. A branded deployment always shows it, whatever the organisation
 * claim says; otherwise the claim's `hidePoweredBy` flag decides, as upstream.
 */
export const shouldShowPoweredByBlock = ({ hidePoweredBy }: { hidePoweredBy?: boolean }) => {
  return IS_BRANDED() || !hidePoweredBy;
};
