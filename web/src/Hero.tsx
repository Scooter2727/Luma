import { motion, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";
import { Play } from "lucide-react";
import { logoForTheme } from "./brand";
import "./hero.css";

type Props = {
  theme: string;
  onTry: () => void;
};

const bubbles = [
  { cls: "o", left: "3%", size: 54, duration: 15, delay: -2 },
  { cls: "b", left: "10%", size: 96, duration: 21, delay: -11 },
  { cls: "g", left: "18%", size: 30, duration: 12, delay: -5 },
  { cls: "o", left: "27%", size: 70, duration: 18, delay: -14 },
  { cls: "g", left: "36%", size: 110, duration: 24, delay: -3 },
  { cls: "b", left: "45%", size: 36, duration: 13, delay: -8 },
  { cls: "o", left: "53%", size: 60, duration: 17, delay: -16 },
  { cls: "g", left: "61%", size: 44, duration: 14, delay: -1 },
  { cls: "b", left: "69%", size: 120, duration: 26, delay: -9 },
  { cls: "o", left: "78%", size: 32, duration: 12, delay: -6 },
  { cls: "g", left: "85%", size: 80, duration: 20, delay: -13 },
  { cls: "b", left: "93%", size: 46, duration: 16, delay: -4 },
  { cls: "g", left: "49%", size: 22, duration: 11, delay: -7, extra: true },
  { cls: "o", left: "89%", size: 24, duration: 13, delay: -10, extra: true },
];

const easeOut = [0.16, 1, 0.3, 1] as const;
const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: easeOut },
  },
};
const caption: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.94 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.7, ease: easeOut, delay: 0.3 },
  },
};

export default function Hero({ theme, onTry }: Props) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="hero-page"
      role="dialog"
      aria-label="Welcome to Luma"
      aria-modal="true"
      initial={false}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0 } }
          : { opacity: 0, transition: { duration: 0.18, ease: "easeOut" } }
      }
    >
      <div className="hero-bubbles" aria-hidden="true">
        {bubbles.map((b, i) => (
          <span
            key={i}
            className={
              "hero-bubble " + b.cls + (b.extra ? " hero-bubble-extra" : "")
            }
            style={{
              left: b.left,
              width: b.size,
              height: b.size,
              animationDuration: b.duration + "s",
              animationDelay: b.delay + "s",
            }}
          />
        ))}
      </div>

      <motion.header
        className="hero-top"
        initial={reduce ? false : { opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <span className="hero-logo">
          <img src={logoForTheme(theme)} alt="" width={44} height={44} />
          <span>Luma</span>
        </span>
      </motion.header>

      <motion.main
        className="hero-content"
        variants={reduce ? undefined : container}
        initial={reduce ? false : "hidden"}
        animate={reduce ? undefined : "visible"}
      >
        <div className="hero-copy">
          <motion.h1 variants={reduce ? undefined : item}>
            Directions you can hear.
          </motion.h1>
          <motion.p className="hero-lede" variants={reduce ? undefined : item}>
            Clock-position guidance at the speed you choose.
            <span className="hero-lede-more">
              {" "}
              — for blind and low-vision pedestrians in downtown Toronto.
            </span>
          </motion.p>
          <motion.div
            className="hero-actions"
            variants={reduce ? undefined : item}
          >
            <motion.button
              className="hero-btn hero-btn-primary"
              onClick={onTry}
              whileHover={reduce ? undefined : { scale: 1.03 }}
              whileTap={reduce ? undefined : { scale: 0.97 }}
            >
              <Play size={30} fill="currentColor" aria-hidden="true" />
              Try Luma
            </motion.button>
          </motion.div>
        </div>

        <motion.div
          className="hero-caption"
          variants={reduce ? undefined : caption}
        >
          <div className="hero-wave" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span className="hero-wave-extra" />
            <span className="hero-wave-extra" />
          </div>
          <p className="hero-caption-line">
            <span className="hero-type">“In 50 m, toward 3 o'clock.”</span>
          </p>
          <p className="hero-caption-sub">
            onto Queen St W · north side, heading west
          </p>
        </motion.div>
      </motion.main>
    </motion.div>
  );
}
