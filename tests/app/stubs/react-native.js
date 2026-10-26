export const alerts = [];
export const Alert = {
  alert(title, message, buttons) { alerts.push({ title, message, buttons: buttons || [] }); },
};
export const Platform = { OS: 'ios', select: (o) => o.ios };
