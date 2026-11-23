-- =============================================================================
-- 0047: Paying no longer locks the squad roster.
--
-- sync_squad_payment_status() (0004/0018) set squads.roster_locked = TRUE on every new payment.
-- The web app no longer uses the roster lock (payments can be submitted any number of times and
-- never freeze the roster), so the trigger must stop writing it. Everything else is unchanged:
-- a new payment still marks the squad SUBMITTED, and verification still decides VERIFIED /
-- SUBMITTED (balance due) / REJECTED.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_squad_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_verified_total INT;
  v_pending_count INT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE squads
    SET payment_status = 'SUBMITTED',
        updated_at = timezone('utc'::text, now())
    WHERE id = NEW.squad_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(COALESCE(amount_received, 0)), 0) INTO v_verified_total
    FROM payments
    WHERE squad_id = NEW.squad_id AND status = 'VERIFIED';

    SELECT count(*) INTO v_pending_count
    FROM payments
    WHERE squad_id = NEW.squad_id AND status = 'SUBMITTED';

    IF v_verified_total > 0 AND v_verified_total >= NEW.amount_expected THEN
      UPDATE squads
      SET payment_status = 'VERIFIED', updated_at = timezone('utc'::text, now())
      WHERE id = NEW.squad_id;
    ELSIF v_pending_count > 0 OR v_verified_total > 0 THEN
      -- Awaiting another receipt, or verified but under-paid: balance due
      UPDATE squads
      SET payment_status = 'SUBMITTED', updated_at = timezone('utc'::text, now())
      WHERE id = NEW.squad_id;
    ELSE
      UPDATE squads
      SET payment_status = 'REJECTED', updated_at = timezone('utc'::text, now())
      WHERE id = NEW.squad_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
