import { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, FlatList } from "react-native";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { FormLabel, FormInput, FormError, ChipRow } from "../publish/FormControls";
import { ProvinceAutocomplete } from "../publish/ProvinceAutocomplete";
import { PhoneInput, PhoneInputValue } from "../shared/PhoneInput";
import { CountryPickerModal } from "../shared/CountryPickerModal";
import { validateAndFormatPhone, splitE164 } from "../../lib/phone";
import { COUNTRIES, findCountry } from "../../lib/countries";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, AccountType } from "../../lib/accountTypes";
import type { Profile } from "../../lib/hooks/useProfile";

// ↔ حقول بيانات الحساب المشتركة بين: تعديل بيانات الحساب (app/edit-profile.tsx)، وإكمال بيانات حساب جوجل،
// وإنشاء حساب بالبريد (app/auth-email.tsx) — نفس البيانات ونفس الشكل فى التلاتة:
// نوع الحساب (إجبارى) · الاسم الأول والثانى · تاريخ الميلاد · الجنس · الجنسية · الإقامة · رقم الهاتف.
export type ProfileFormValue = {
  accountType: AccountType | "";
  firstName: string;
  lastName: string;
  birthDay: string;
  birthMonth: string;
  birthYear: string;
  gender: "male" | "female" | "";
  nationalityCode: string;
  residence: string;
  phone: PhoneInputValue;
};

export const EMPTY_PROFILE_FORM: ProfileFormValue = {
  accountType: "", firstName: "", lastName: "", birthDay: "", birthMonth: "", birthYear: "",
  gender: "", nationalityCode: "", residence: "", phone: { countryIso2: "", localNumber: "" },
};

// ↔ تعبئة النموذج من البروفايل المحفوظ. حساب جوجل: الاسم بييجى فى full_name بس، فنقسمه كقيمة مبدئية (splitFullName).
export function formFromProfile(profile: Profile, splitFullName: boolean): ProfileFormValue {
  const parts = (profile.fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const form: ProfileFormValue = {
    ...EMPTY_PROFILE_FORM,
    accountType: profile.accountType ?? "",
    firstName: profile.firstName ?? (splitFullName ? parts[0] ?? "" : ""),
    lastName: profile.lastName ?? (splitFullName ? parts.slice(1).join(" ") : ""),
    gender: profile.gender ?? "",
    nationalityCode: profile.nationality ?? "",
    residence: profile.residence ?? "",
  };
  if (profile.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate)) {
    const [y, m, d] = profile.birthDate.split("-");
    form.birthYear = y; form.birthMonth = m; form.birthDay = d;
  }
  if (profile.phoneE164) {
    const split = splitE164(profile.phoneE164);
    form.phone = {
      countryIso2: split?.countryIso2 ?? (profile.phoneCountryCode ? (findCountry(profile.phoneCountryCode)?.code ?? "") : ""),
      localNumber: split?.localNumber ?? "",
    };
  }
  return form;
}

export type ProfileFormCheck =
  | { ok: true; birthDate?: string; phone: { phoneE164?: string; phoneCountryCode?: string; phoneCountryName?: string } }
  | { ok: false; title: string; message: string };

// ↔ نفس تحققات شاشة تعديل البيانات: الهاتف صحيح (لو مكتوب) وتاريخ الميلاد كامل أو فاضى. نوع الحساب بيتحقق منه المستدعى.
export function checkProfileForm(v: ProfileFormValue, t: (s: string) => string): ProfileFormCheck {
  let phone: { phoneE164?: string; phoneCountryCode?: string; phoneCountryName?: string } = {};
  if (v.phone.localNumber.trim()) {
    const country = findCountry(v.phone.countryIso2);
    const result = validateAndFormatPhone(v.phone.localNumber, v.phone.countryIso2);
    if (!result.valid) {
      return { ok: false, title: t("رقم الهاتف غير صحيح"), message: t("تأكد من كتابة رقم الهاتف بشكل صحيح.") };
    }
    phone = { phoneE164: result.e164, phoneCountryCode: country?.callingCode ?? undefined, phoneCountryName: country?.nameAr ?? undefined };
  }
  const filled = [v.birthDay, v.birthMonth, v.birthYear].filter(Boolean).length;
  if (filled > 0 && filled < 3) {
    return { ok: false, title: t("تاريخ الميلاد غير مكتمل"), message: t("اختر اليوم والشهر والسنة الثلاثة، أو اتركهم فارغين.") };
  }
  return { ok: true, birthDate: filled === 3 ? `${v.birthYear}-${v.birthMonth}-${v.birthDay}` : undefined, phone };
}

const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

type Props = {
  value: ProfileFormValue;
  onChange: (patch: Partial<ProfileFormValue>) => void;
  accountTypeError?: boolean;
  // ↔ الاسم الأول إجبارى (فى إنشاء الحساب بالبريد)؛ فى تعديل البيانات اختيارى.
  firstNameRequired?: boolean;
  firstNameError?: boolean;
};

export function ProfileFields({ value, onChange, accountTypeError, firstNameRequired, firstNameError }: Props) {
  const { t, language } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const [datePickerField, setDatePickerField] = useState<"day" | "month" | "year" | null>(null);
  const [nationalityPickerVisible, setNationalityPickerVisible] = useState(false);

  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => Array.from({ length: 100 }, (_, i) => String(currentYear - 13 - i)), [currentYear]);
  const monthOptions = useMemo(() => MONTH_NAMES_AR.map((name, i) => ({ value: String(i + 1).padStart(2, "0"), label: name })), []);
  const dayOptions = useMemo(() => {
    const monthNum = value.birthMonth ? parseInt(value.birthMonth, 10) : 0;
    const yearNum = value.birthYear ? parseInt(value.birthYear, 10) : 0;
    const daysInMonth = monthNum && yearNum ? new Date(yearNum, monthNum, 0).getDate() : 31;
    return Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, "0"));
  }, [value.birthMonth, value.birthYear]);

  const nationalityCountry = COUNTRIES.find((c) => c.code === value.nationalityCode);

  return (
    <View>
      <FormLabel text={t("نوع الحساب")} required />
      <ChipRow
        options={ACCOUNT_TYPES}
        value={value.accountType}
        onChange={(v) => onChange({ accountType: v })}
        labels={ACCOUNT_TYPE_LABELS}
      />
      {accountTypeError && <Text style={styles.errorText}>{t("اختر نوع الحساب أولاً")}</Text>}

      <FormLabel text={t("الاسم الأول")} required={firstNameRequired} optional={!firstNameRequired} />
      <FormInput value={value.firstName} onChangeText={(v) => onChange({ firstName: v })} placeholder={t("الاسم الأول")} error={firstNameError} />
      {firstNameRequired && <FormError text={t("من فضلك أدخل اسمًا صحيحًا")} show={!!firstNameError} />}

      <FormLabel text={t("الاسم الثاني")} optional />
      <FormInput value={value.lastName} onChangeText={(v) => onChange({ lastName: v })} placeholder={t("الاسم الثاني")} />

      <FormLabel text={t("تاريخ الميلاد")} optional />
      <View style={styles.dateRow}>
        <Pressable style={[styles.selectBox, styles.dateBox]} onPress={() => setDatePickerField("day")}>
          <Text style={value.birthDay ? styles.selectText : styles.selectPlaceholder}>{value.birthDay || t("يوم")}</Text>
        </Pressable>
        <Pressable style={[styles.selectBox, styles.dateBox]} onPress={() => setDatePickerField("month")}>
          <Text style={value.birthMonth ? styles.selectText : styles.selectPlaceholder} numberOfLines={1}>
            {value.birthMonth ? monthOptions.find((m) => m.value === value.birthMonth)?.label : t("شهر")}
          </Text>
        </Pressable>
        <Pressable style={[styles.selectBox, styles.dateBox]} onPress={() => setDatePickerField("year")}>
          <Text style={value.birthYear ? styles.selectText : styles.selectPlaceholder}>{value.birthYear || t("سنة")}</Text>
        </Pressable>
      </View>

      <FormLabel text={t("الجنس")} optional />
      <ChipRow options={["male", "female"]} value={value.gender} onChange={(v) => onChange({ gender: v })} labels={{ male: "ذكر", female: "أنثى" }} />

      <FormLabel text={t("الجنسية")} optional />
      <Pressable style={styles.selectBox} onPress={() => setNationalityPickerVisible(true)}>
        <Text style={nationalityCountry ? styles.selectText : styles.selectPlaceholder}>
          {nationalityCountry ? (language === "ar" ? nationalityCountry.nameAr : nationalityCountry.nameEn) : t("اختر الجنسية")}
        </Text>
      </Pressable>

      <FormLabel text={t("الإقامة")} optional />
      <ProvinceAutocomplete value={value.residence} onChange={(v) => onChange({ residence: v })} />

      <FormLabel text={t("رقم الهاتف")} optional />
      <PhoneInput value={value.phone} onChange={(v) => onChange({ phone: v })} />

      <CountryPickerModal
        visible={nationalityPickerVisible}
        selectedCode={value.nationalityCode}
        onSelect={(c) => { onChange({ nationalityCode: c.code }); setNationalityPickerVisible(false); }}
        onClose={() => setNationalityPickerVisible(false)}
      />

      <Modal visible={datePickerField !== null} transparent animationType="fade" onRequestClose={() => setDatePickerField(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDatePickerField(null)}>
          <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>
              {datePickerField === "day" ? t("اليوم") : datePickerField === "month" ? t("الشهر") : t("السنة")}
            </Text>
            <FlatList
              data={datePickerField === "day" ? dayOptions : datePickerField === "month" ? monthOptions.map((m) => m.value) : yearOptions}
              keyExtractor={(v) => v}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => {
                const label = datePickerField === "month" ? monthOptions.find((m) => m.value === item)?.label : item;
                return (
                  <Pressable
                    style={styles.modalOption}
                    onPress={() => {
                      if (datePickerField === "day") onChange({ birthDay: item });
                      else if (datePickerField === "month") onChange({ birthMonth: item });
                      else if (datePickerField === "year") onChange({ birthYear: item });
                      setDatePickerField(null);
                    }}
                  >
                    <Text style={styles.modalOptionText}>{label}</Text>
                  </Pressable>
                );
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    errorText: { color: "#DC2626", fontSize: 12, fontWeight: "700", marginTop: -8, marginBottom: 12 },
    selectBox: { backgroundColor: themeColors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 14 },
    selectText: { fontSize: 13.5, fontWeight: "700", color: themeColors.text },
    selectPlaceholder: { fontSize: 13.5, fontWeight: "700", color: themeColors.textSubtle },
    dateRow: { flexDirection: "row", gap: 8 },
    dateBox: { flex: 1, alignItems: "center" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    modalSheet: { backgroundColor: themeColors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingBottom: 24, maxHeight: "60%" },
    modalTitle: { fontSize: 14, fontWeight: "900", color: themeColors.text, textAlign: "center", marginBottom: 8 },
    modalOption: { paddingVertical: 13, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: themeColors.border },
    modalOptionText: { fontSize: 14, fontWeight: "700", color: themeColors.text, textAlign: "center" },
  });
}
