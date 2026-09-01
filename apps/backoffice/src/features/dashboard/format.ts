const numberFormatter = new Intl.NumberFormat();

export const formatNumber = (value: number) => numberFormatter.format(value);
