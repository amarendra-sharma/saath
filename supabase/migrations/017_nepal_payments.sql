-- 017: Nepal payment methods (eSewa, Khalti, bank in Nepal) for receivers' payment details.
-- Only widens the allowed list; nothing existing changes.
alter table public.saath_pay_methods drop constraint if exists saath_pay_methods_method_check;
alter table public.saath_pay_methods add constraint saath_pay_methods_method_check
  check (method in ('upi','bank_in','bank_intl','sepa','wise','paypal','revolut','zelle','venmo',
                    'cashapp','remitly','western_union','mpesa','pix','esewa','khalti','bank_np','cash','other'));
