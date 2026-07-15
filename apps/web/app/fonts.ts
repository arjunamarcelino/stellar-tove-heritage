import localFont from 'next/font/local';

export const lora = localFont({
  src: [
    { path: './fonts/Lora-Regular.woff2', weight: '400' },
    { path: './fonts/Lora-SemiBold.woff2', weight: '600' },
    { path: './fonts/Lora-Bold.woff2', weight: '700' },
  ],
  variable: '--font-lora',
  display: 'swap',
});

export const montserrat = localFont({
  src: [
    { path: './fonts/Montserrat-Regular.woff2', weight: '400' },
    { path: './fonts/Montserrat-SemiBold.woff2', weight: '600' },
    { path: './fonts/Montserrat-Bold.woff2', weight: '700' },
  ],
  variable: '--font-montserrat',
  display: 'swap',
});
