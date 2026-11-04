import { Redirect } from "expo-router";
import { useApp } from "../lib/app";

export default function Index() {
  const { session } = useApp();
  return <Redirect href={session ? "/home" : "/welcome"} />;
}
